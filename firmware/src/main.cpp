#include <Arduino.h>
#include <Arduino_GFX_Library.h>
#include <ArduinoJson.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <Preferences.h>
#include <LittleFS.h>
#include <Wire.h>
#include <esp_heap_caps.h>
#include <esp_sntp.h>
#include <time.h>
#include "board.h"
#include "ca_bundle.h"
#include "secrets.h"
#include "FreeSansBold10pt7b.h"
#include "tiffin_logo.h"
#ifdef CROWPANEL5
#include "smooth_font_large.h"
#else
#include "smooth_font.h"
#endif

constexpr uint16_t BG=0xE754, FG=0x2248, MUTED=0x638B;
constexpr size_t MAX_BODY=256*1024;
const char* DEFAULT_URL="https://ai-school-planner-backend.vercel.app";
struct RamAllocator {
  void* allocate(size_t n){return heap_caps_malloc(n,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);}
  void deallocate(void* p){heap_caps_free(p);}
  void* reallocate(void* p,size_t n){return heap_caps_realloc(p,n,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);}
};
using Document=BasicJsonDocument<RamAllocator>;
Document* snapshotPtr=nullptr;
#define snapshot (*snapshotPtr)
#ifdef CROWPANEL5
#include "crowpanel_display.h"
Arduino_GFX* gfx=new CrowPanelDisplay();
#else
Arduino_DataBus* bus=new Arduino_ESP32SPI(LCD_DC,LCD_CS,LCD_SCLK,LCD_MOSI,LCD_MISO,FSPI);
Arduino_GFX* gfx=new Arduino_ST7796(bus,LCD_RST,1,true,320,480);
#endif
class PlannerCanvas : public Arduino_Canvas {
 public: PlannerCanvas():Arduino_Canvas(SCREEN_W,SCREEN_H,nullptr){}
 bool begin(int32_t speed=GFX_NOT_DEFINED) override {
   if(!_framebuffer)_framebuffer=(uint16_t*)heap_caps_malloc(SCREEN_W*SCREEN_H*2,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);
   return _framebuffer!=nullptr;
 }
};
PlannerCanvas* agendaCanvas=nullptr;
uint16_t* previousFrame=nullptr;
uint16_t* transitionFrame=nullptr;
bool haveFrame=false;
int transitionAxis=0,transitionDirection=1;
Preferences prefs;
WebServer portal(80);
DNSServer dns;
SemaphoreHandle_t filesLock;
String ssid,wifiPass,deviceToken,backendUrl,selectedDate,csrf,apPassword;
volatile bool clockValid=false,cacheChanged=false;
volatile time_t cachedReceivedAt=0;
volatile int networkState=0; // 0 starting, 1 OK, 2 offline, 3 auth, 4 TLS/network, 5 data, 6 waiting clock
bool fsReady=false,setupMode=false,redraw=true,followTomorrow=true;
int page=0;
uint32_t lastFrame=0,portalStarted=0,bootHeld=0;
const char* TZ_LONDON="GMT0BST,M3.5.0/1,M10.5.0";

String randomHex(size_t bytes){String result; const char h[]="0123456789abcdef";for(size_t i=0;i<bytes;i++){uint8_t b=esp_random();result+=h[b>>4];result+=h[b&15];}return result;}
String hotspotPin(){String pin;while(pin.length()<8){uint8_t value=uint8_t(esp_random());if(value<250)pin+=char('0'+value%10);}return pin;}
String dateOf(time_t t){struct tm tm;localtime_r(&t,&tm);char out[11];strftime(out,sizeof(out),"%Y-%m-%d",&tm);return out;}
String shiftDate(String d,int days){struct tm tm={};if(!strptime(d.c_str(),"%Y-%m-%d",&tm))return "";tm.tm_hour=12;tm.tm_mday+=days;tm.tm_isdst=-1;return dateOf(mktime(&tm));}
time_t parseUtc(const char* value){
  if(!value)return 0;
  int y,m,d,h,mi,se;if(sscanf(value,"%d-%d-%dT%d:%d:%d",&y,&m,&d,&h,&mi,&se)!=6)return 0;
  if(y<2020||y>2100||m<1||m>12||h<0||h>23||mi<0||mi>59||se<0||se>59)return 0;
  bool leap=(y%4==0&&(y%100!=0||y%400==0));
  const int lengths[]={31,28,31,30,31,30,31,31,30,31,30,31};
  if(d<1||d>lengths[m-1]+(m==2&&leap))return 0;
  long days=365L*(y-1970)+(y-1)/4-1969/4-(y-1)/100+1969/100+(y-1)/400-1969/400;
  for(int month=1;month<m;month++)days+=lengths[month-1]+(month==2&&leap);
  return time_t((days+d-1)*86400LL+h*3600+mi*60+se);
}
String localTime(const char* text){time_t t=parseUtc(text);struct tm tm;localtime_r(&t,&tm);char out[6];strftime(out,sizeof(out),"%H:%M",&tm);return out;}
String shortTitle(String title){int pos=title.indexOf(" (");return pos>0?title.substring(0,pos):title;}
void textAt(int x,int y,String text,int size=1,uint16_t color=FG,int maxChars=80){
  // Initial firmware uses the built-in Latin font. Unknown Unicode is visibly replaced.
  String ascii;for(size_t i=0;i<text.length();i++){uint8_t c=text[i];if(c<128)ascii+=char(c);else if((c&0xc0)!=0x80)ascii+='?';}
  if(ascii.length()>size_t(maxChars))ascii=ascii.substring(0,maxChars-3)+"...";
  gfx->setFont(nullptr);gfx->setTextSize(size);gfx->setTextColor(color);gfx->setCursor(x,y);gfx->print(ascii);
}
bool validSnapshot(Document& doc){
  if(doc.overflowed() || doc["schemaVersion"]!=1 || strcmp(doc["timezone"]|"","Europe/London"))return false;
  String source=doc["source"]|"";
  if(source!="arbor"&&source!="demo"&&source!="manual")return false;
  String first=doc["coverageStart"]|"",last=doc["coverageEnd"]|"";
  if(first.length()!=10||last.length()!=10||first>last||!parseUtc(doc["receivedAt"]))return false;
  if(!doc["events"].is<JsonArray>()||doc["events"].size()>500)return false;
  for(JsonObject e:doc["events"].as<JsonArray>()){
    if(!e["id"].is<const char*>()||!e["title"].is<const char*>()||strlen(e["title"])>100)return false;
    if(!parseUtc(e["start"])||parseUtc(e["end"])<=parseUtc(e["start"]))return false;
    String date=dateOf(parseUtc(e["start"]));if(date<first||date>last)return false;
  }
  return true;
}
void loadCache(){
  if(!fsReady)return;
  xSemaphoreTake(filesLock,portMAX_DELAY);
  for(const char* path : {"/snapshot.json", "/snapshot.bak"}){
    File f=LittleFS.open(path,"r");if(!f)continue;
    Document candidate(MAX_BODY);auto err=deserializeJson(candidate,f);f.close();
    if(!err&&validSnapshot(candidate)){snapshot=candidate;cachedReceivedAt=parseUtc(candidate["receivedAt"]);break;}
  }
  xSemaphoreGive(filesLock);
}
int dayEvents(JsonObject* rows){int count=0;for(JsonObject e:snapshot["events"].as<JsonArray>()){if(dateOf(parseUtc(e["start"]))==selectedDate){if(count<64)rows[count++]=e;}}return count;}
constexpr uint16_t rgb(unsigned r,unsigned g,unsigned b){return ((r&248)<<8)|((g&252)<<3)|(b>>3);}
constexpr uint16_t PAPER=rgb(243,242,238),INK=rgb(34,39,37),CARD=rgb(255,255,253),FOREST=rgb(34,77,65),SECONDARY=rgb(111,117,111);
String latin(String value){String clean;for(size_t i=0;i<value.length();i++){uint8_t c=value[i];if(c>=32&&c<127)clean+=char(c);else if(c>=128&&(c&0xc0)!=0x80)clean+='?';}return clean;}
int smoothWidth(const String& text,const SmoothFont& font){int width=0;for(char c:text)width+=font.glyphs[c-32].advance;return width;}
void smooth(int x,int baseline,String value,const SmoothFont& font,uint16_t fg,uint16_t bg,int maxWidth){
  value=latin(value);if(smoothWidth(value,font)>maxWidth){while(value.length()&&smoothWidth(value+"...",font)>maxWidth)value.remove(value.length()-1);value+="...";}
  uint16_t pixels[1600];
  for(char c:value){const SmoothGlyph& g=font.glyphs[c-32];
    if(g.w*g.h>1600)continue;
    for(unsigned i=0;i<g.w*g.h;i++){unsigned a=font.alpha[g.offset+i];unsigned r=((((fg>>11)&31)*a+((bg>>11)&31)*(255-a)+127)/255);unsigned green=((((fg>>5)&63)*a+((bg>>5)&63)*(255-a)+127)/255);unsigned b=(((fg&31)*a+(bg&31)*(255-a)+127)/255);pixels[i]=(r<<11)|(green<<5)|b;}
    if(g.w&&g.h)gfx->draw16bitRGBBitmap(x+g.x,baseline+g.y,pixels,g.w,g.h);x+=g.advance;
  }
}
void drawAgenda(){
  gfx->fillScreen(PAPER);
#ifdef CROWPANEL5
  gfx->fillRoundRect(24,20,60,60,16,FOREST);gfx->draw16bitRGBBitmap(35,31,const_cast<uint16_t*>(TIFFIN_LOGO),38,38);
  smooth(103,37,"TIFFIN SCHOOL",SmallFont,FOREST,PAPER,330);
  String tomorrow=clockValid?shiftDate(dateOf(time(nullptr)),1):"";
  smooth(101,76,selectedDate==tomorrow?"Tomorrow":"School plans",HeadingFont,INK,PAPER,425);
  struct tm day={};char dateText[40]={};if(strptime(selectedDate.c_str(),"%Y-%m-%d",&day)){day.tm_hour=12;day.tm_isdst=-1;mktime(&day);strftime(dateText,sizeof(dateText),"%a, %d %b",&day);}
  smooth(568,66,dateText,BodyFont,FOREST,PAPER,210);
  JsonObject rows[64];int count=dayEvents(rows),pages=max(1,(count+PER_PAGE-1)/PER_PAGE);page=constrain(page,0,pages-1);
  String week=count?String(rows[0]["week"]|""):"";
  smooth(26,104,String(count)+" activities"+(week.length()?"   /   Week "+week:""),SmallFont,SECONDARY,PAPER,480);
  String source=snapshot["source"]|"";if(source=="demo"||source=="manual")smooth(690,104,source,SmallFont,SECONDARY,PAPER,85);
  bool covered=snapshot.size()&&selectedDate>=String(snapshot["coverageStart"]|"")&&selectedDate<=String(snapshot["coverageEnd"]|"");
  if(!count){gfx->fillRoundRect(24,116,752,304,18,CARD);smooth(55,245,covered?"A clear day ahead":"Not synchronized yet",TitleFont,INK,CARD,680);smooth(55,285,covered?"No activities scheduled.":"This date is not in the saved timetable.",BodyFont,SECONDARY,CARD,680);}
  for(int i=page*PER_PAGE;i<min(count,(page+1)*PER_PAGE);i++){
    int y=116+(i%PER_PAGE)*78;JsonObject e=rows[i];gfx->fillRoundRect(24,y,752,70,14,CARD);
    smooth(42,y+31,localTime(e["start"]),TitleFont,FOREST,CARD,90);
    smooth(44,y+56,localTime(e["end"]),SmallFont,SECONDARY,CARD,85);
    gfx->drawFastVLine(145,y+16,38,rgb(227,230,223));
    smooth(164,y+31,shortTitle(e["title"]|""),TitleFont,INK,CARD,587);
    String room=e["location"]|"";String staff=e["staff"]|"";if(!staff.length())staff="Teacher not listed";
    smooth(164,y+58,staff,BodyFont,SECONDARY,CARD,room.length()?460:587);
    if(room.length())smooth(651,y+57,room,SmallFont,FOREST,CARD,105);
  }
#else
  gfx->fillRoundRect(16,13,44,44,11,FOREST);gfx->draw16bitRGBBitmap(19,16,const_cast<uint16_t*>(TIFFIN_LOGO),38,38);
  smooth(72,23,"TIFFIN SCHOOL",SmallFont,FOREST,PAPER,190);
  String tomorrow=clockValid?shiftDate(dateOf(time(nullptr)),1):"";
  smooth(70,54,selectedDate==tomorrow?"Tomorrow":"School plans",HeadingFont,INK,PAPER,214);
  struct tm day={};char dateText[40]={};if(strptime(selectedDate.c_str(),"%Y-%m-%d",&day)){day.tm_hour=12;day.tm_isdst=-1;mktime(&day);strftime(dateText,sizeof(dateText),"%a, %d %b",&day);}
  smooth(310,49,dateText,BodyFont,FOREST,PAPER,155);
  JsonObject rows[64];int count=dayEvents(rows),pages=max(1,(count+PER_PAGE-1)/PER_PAGE);page=constrain(page,0,pages-1);
  String week=count?String(rows[0]["week"]|""):"";
  smooth(18,78,String(count)+" activities"+(week.length()?"   /   Week "+week:""),SmallFont,SECONDARY,PAPER,310);
  String source=snapshot["source"]|"";if(source=="demo"||source=="manual")smooth(395,78,source,SmallFont,SECONDARY,PAPER,70);
  bool covered=snapshot.size()&&selectedDate>=String(snapshot["coverageStart"]|"")&&selectedDate<=String(snapshot["coverageEnd"]|"");
  if(!count){gfx->fillRoundRect(14,90,452,184,14,CARD);smooth(38,167,covered?"A clear day ahead":"Not synchronized yet",TitleFont,INK,CARD,400);smooth(38,199,covered?"No activities scheduled.":"This date is not in the saved timetable.",BodyFont,SECONDARY,CARD,400);}
  for(int i=page*PER_PAGE;i<min(count,(page+1)*PER_PAGE);i++){
    int y=88+(i%3)*64;JsonObject e=rows[i];gfx->fillRoundRect(14,y,452,58,12,CARD);
    smooth(25,y+25,localTime(e["start"]),TitleFont,FOREST,CARD,65);
    smooth(27,y+45,localTime(e["end"]),SmallFont,SECONDARY,CARD,60);
    gfx->drawFastVLine(98,y+15,29,rgb(227,230,223));
    smooth(111,y+25,shortTitle(e["title"]|""),TitleFont,INK,CARD,338);
    String room=e["location"]|"";String staff=e["staff"]|"";if(!staff.length())staff="Teacher not listed";
    smooth(111,y+47,staff,BodyFont,SECONDARY,CARD,room.length()?255:337);
    if(room.length())smooth(384,y+46,room,SmallFont,FOREST,CARD,66);
  }
#endif
  String status;uint16_t statusColor=FOREST;
  if(WiFi.status()!=WL_CONNECTED)status="Offline";
  else if(!clockValid)status="Setting clock";
  else if(networkState==3)status="Device key rejected";
  else if(networkState==4)status="Sync failed";
  else if(networkState==5)status="Storage error";
  else if(networkState==1)status="Updated "+localTime(snapshot["receivedAt"]);
  else status="Connecting";
  if(networkState==3||networkState==4||networkState==5)statusColor=rgb(163,75,55);
  if(snapshot.size()&&clockValid&&time(nullptr)-parseUtc(snapshot["receivedAt"])>26*3600){status="Old data / "+status;statusColor=rgb(152,113,46);}
#ifdef CROWPANEL5
  gfx->fillCircle(30,446,3,statusColor);smooth(41,452,status,SmallFont,statusColor,PAPER,335);
  for(int d=0;d<min(pages,9);d++)gfx->fillCircle(400+(d-(min(pages,9)-1)/2.0)*13,446,d==page?4:2,d==page?FOREST:rgb(191,197,189));
  smooth(712,452,String(page+1)+" / "+pages,SmallFont,SECONDARY,PAPER,65);
  gfx->fillRoundRect(350,473,100,4,2,rgb(176,185,175));
#else
  gfx->fillCircle(20,293,2,statusColor);smooth(29,297,status,SmallFont,statusColor,PAPER,185);
  for(int d=0;d<min(pages,9);d++)gfx->fillCircle(240+(d-(min(pages,9)-1)/2.0)*10,293,d==page?3:2,d==page?FOREST:rgb(191,197,189));
  smooth(415,297,String(page+1)+" / "+pages,SmallFont,SECONDARY,PAPER,52);
  gfx->fillRoundRect(211,310,58,3,2,rgb(176,185,175));
#endif
}

void presentAgenda(){
  if(!agendaCanvas||!previousFrame||!transitionFrame){drawAgenda();gfx->flush();transitionAxis=0;return;}
  uint16_t* next=agendaCanvas->getFramebuffer();
  if(haveFrame)memcpy(previousFrame,next,SCREEN_W*SCREEN_H*2);
  Arduino_GFX* display=gfx;gfx=agendaCanvas;drawAgenda();gfx=display;
  if(haveFrame&&transitionAxis){
    // Animate only the course area to keep SPI frame time short and the header stable.
    constexpr int TOP=ANIM_TOP,HEIGHT=ANIM_H,WIDTH=SCREEN_W;
    uint32_t started=millis();float progress=0;
    do{
      progress=min(1.0f,float(millis()-started)/320.0f);
      float eased=progress*progress*(3.0f-2.0f*progress);
      int distance=transitionAxis==1?WIDTH:HEIGHT;
      int shift=constrain(int(eased*distance+0.5f),0,distance);
      for(int y=0;y<HEIGHT;y++){
        uint16_t* dest=transitionFrame+y*WIDTH;
        if(transitionAxis==1){
          uint16_t* oldRow=previousFrame+(TOP+y)*WIDTH;uint16_t* newRow=next+(TOP+y)*WIDTH;
          if(transitionDirection>0){memcpy(dest,oldRow+shift,(WIDTH-shift)*2);memcpy(dest+WIDTH-shift,newRow,shift*2);}
          else{memcpy(dest,newRow+WIDTH-shift,shift*2);memcpy(dest+shift,oldRow,(WIDTH-shift)*2);}
        }else{
          int sourceY=y+transitionDirection*shift;uint16_t* source;
          if(sourceY>=0&&sourceY<HEIGHT)source=previousFrame+(TOP+sourceY)*WIDTH;
          else{sourceY+=sourceY<0?HEIGHT:-HEIGHT;source=next+(TOP+sourceY)*WIDTH;}
          memcpy(dest,source,WIDTH*2);
        }
      }
      display->draw16bitRGBBitmap(0,TOP,transitionFrame,WIDTH,HEIGHT);display->flush();
#ifdef CROWPANEL5
      delay(12); // Avoid saturating PSRAM while the RGB peripheral scans continuously.
#else
      delay(1);
#endif
    }while(progress<1.0f);
  }
  display->draw16bitRGBBitmap(0,0,next,SCREEN_W,SCREEN_H);display->flush();haveFrame=true;transitionAxis=0;
}

class LimitedFile:public Stream {
 public:File file;size_t total=0;bool exceeded=false;
 LimitedFile(File f):file(f){}
 size_t write(uint8_t b)override{return write(&b,1);}
 size_t write(const uint8_t* b,size_t n)override{if(total+n>MAX_BODY){exceeded=true;return 0;}size_t done=file.write(b,n);total+=done;return done;}
 int available()override{return 0;}int read()override{return -1;}int peek()override{return -1;}void flush()override{file.flush();}
};
bool downloadSnapshot(){
  if(!fsReady){networkState=5;return false;}
  WiFiClientSecure tls;tls.setCACert(ROOT_CA);tls.setHandshakeTimeout(12);
  HTTPClient http;http.setConnectTimeout(10000);http.setTimeout(15000);http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
  if(!http.begin(tls,backendUrl+"/api/device-snapshot")){networkState=4;return false;}
  http.addHeader("Authorization","Bearer "+deviceToken);
  int code=http.GET();
  Serial.printf("[sync] HTTP=%d heap=%u psram=%u\n",code,ESP.getFreeHeap(),ESP.getFreePsram());
  if(code<0){char reason[160]={};tls.lastError(reason,sizeof(reason));Serial.printf("[sync] TLS: %s\n",reason);}
  if(code!=200){networkState=(code==401||code==403)?3:4;http.end();return false;}
  if(http.getSize()>int(MAX_BODY)){networkState=5;http.end();return false;}
  xSemaphoreTake(filesLock,portMAX_DELAY);
  File temp=LittleFS.open("/snapshot.tmp","w");
  if(!temp){xSemaphoreGive(filesLock);http.end();networkState=5;return false;}
  LimitedFile output(temp);int bytes=http.writeToStream(&output);output.flush();temp.close();http.end();
  bool ok=bytes>0&&!output.exceeded;
  Document candidate(MAX_BODY);
  if(ok){File f=LittleFS.open("/snapshot.tmp","r");auto error=deserializeJson(candidate,f);ok=!error&&validSnapshot(candidate);Serial.printf("[sync] bytes=%d json=%s valid=%d\n",bytes,error.c_str(),ok);f.close();}
  if(ok){
    if(LittleFS.exists("/snapshot.json")){
      LittleFS.remove("/snapshot.bak");ok=LittleFS.rename("/snapshot.json","/snapshot.bak");
    }
    if(ok)ok=LittleFS.rename("/snapshot.tmp","/snapshot.json");
  }
  if(!ok)LittleFS.remove("/snapshot.tmp");
  xSemaphoreGive(filesLock);
  networkState=ok?1:5;if(ok){cachedReceivedAt=parseUtc(candidate["receivedAt"]);cacheChanged=true;}return ok;
}
void networkTask(void*){
  uint32_t lastTry=0;bool attempted=false;
  for(;;){
    if(WiFi.status()!=WL_CONNECTED){networkState=2;WiFi.reconnect();vTaskDelay(pdMS_TO_TICKS(30000));continue;}
    if(!clockValid){networkState=6;vTaskDelay(pdMS_TO_TICKS(1000));continue;}
    time_t now=time(nullptr);struct tm slot;localtime_r(&now,&slot);slot.tm_hour=21;slot.tm_min=0;slot.tm_sec=0;slot.tm_isdst=-1;
    time_t due=mktime(&slot);if(now<due){slot.tm_mday--;slot.tm_isdst=-1;due=mktime(&slot);}
    // Device reads our cache only. No request can trigger an Arbor login.
    bool needsUpdate=!cachedReceivedAt||cachedReceivedAt<due;
    if(needsUpdate&&(!attempted||uint32_t(millis()-lastTry)>=10*60*1000)){
      downloadSnapshot();lastTry=millis();attempted=true;
    }else if(!needsUpdate)networkState=1;
    vTaskDelay(pdMS_TO_TICKS(1000));
  }
}

bool validOrigin(String value){
  if(!value.startsWith("https://")||value.length()>180)return false;
  String host=value.substring(8);if(!host.length()||host.indexOf('.')<0)return false;
  for(char c:host)if(!isalnum(c)&&c!='.'&&c!='-')return false;
  return true;
}
void setupPortal(){
  setupMode=true;portalStarted=millis();csrf=randomHex(16);apPassword=hotspotPin();
  WiFi.mode(WIFI_AP_STA);WiFi.scanNetworks(true);String ap="SchoolPlanner-"+String(uint32_t(ESP.getEfuseMac()),HEX).substring(0,6);
  WiFi.softAP(ap.c_str(),apPassword.c_str(),1,false,1);dns.start(53,"*",WiFi.softAPIP());
  gfx->fillScreen(BG);textAt(15,20,"First-time setup",3);textAt(15,72,"Connect phone to WiFi:",2);textAt(15,103,ap,2);
  textAt(15,145,"WiFi password: "+apPassword,2);textAt(15,195,"Open http://192.168.4.1",2);textAt(15,255,"Hold BOOT 3 seconds to reopen setup.");textAt(15,278,"Setup closes after 10 minutes.");
  portal.on("/",HTTP_GET,[]{
    String html=R"HTML(<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>School Planner setup</title><style>body{font:18px sans-serif;max-width:440px;margin:24px auto;padding:16px;background:#f4f7ef}select,input,button{box-sizing:border-box;width:100%;padding:14px;margin:10px 0 20px;font:inherit}button{cursor:pointer}small{color:#52624a}</style><h1>School Planner</h1><p>选择家庭 Wi-Fi，输入密码即可。</p><form method="post" action="/save"><label>Wi-Fi<select name="ssid" id="networks" required><option value="">正在扫描附近网络…</option></select></label><button type="button" id="rescan">重新扫描</button><small id="status">仅显示 2.4 GHz 网络</small><p><label>Wi-Fi 密码<input id="wifi-password" name="wifi" type="password" minlength="8" maxlength="63" required autocomplete="current-password" autocapitalize="none" autocorrect="off" spellcheck="false"><button type="button" id="show-password" aria-controls="wifi-password" aria-pressed="false">显示密码 / 方便粘贴</button><small>长按输入框选择粘贴。如果热点弹窗不能粘贴，请用 Safari 或 Chrome 打开 http://192.168.4.1</small></label></p><input type="hidden" name="csrf" value=")HTML";
    html+=csrf+R"HTML("><button id="save" disabled>保存并连接</button></form><script>
const list=document.getElementById('networks'),status=document.getElementById('status'),save=document.getElementById('save'),rescan=document.getElementById('rescan');
async function scan(restart=false){rescan.disabled=true;status.textContent='正在扫描…';try{const r=await fetch('/networks'+(restart?'?restart=1':''),{cache:'no-store'});if(!r.ok)throw Error();const data=await r.json();if(data.scanning){setTimeout(()=>scan(),1500);return;}const old=list.value;list.replaceChildren(new Option('请选择 Wi-Fi',''));for(const n of data.networks)list.add(new Option(n.ssid+' ('+n.rssi+' dBm)',n.ssid));if([...list.options].some(o=>o.value===old))list.value=old;save.disabled=!list.value;status.textContent=data.networks.length?'仅显示 2.4 GHz 网络':'未找到网络，请确认路由器开启 2.4 GHz 后重新扫描';}catch{status.textContent='扫描失败，请重新扫描';}rescan.disabled=false;}
document.getElementById('show-password').onclick=function(){const input=document.getElementById('wifi-password');const show=input.type==='password';input.type=show?'text':'password';this.textContent=show?'隐藏密码':'显示密码 / 方便粘贴';this.setAttribute('aria-pressed',String(show));input.focus();};
list.onchange=()=>save.disabled=!list.value;rescan.onclick=()=>scan(true);scan();
</script>)HTML";
    portal.sendHeader("Cache-Control","no-store");portal.send(200,"text/html",html);
  });
  portal.on("/networks",HTTP_GET,[]{
    if(portal.hostHeader()!="192.168.4.1"){portal.send(403,"text/plain","Invalid host");return;}
    int count=WiFi.scanComplete();
    if(portal.hasArg("restart")&&count!=WIFI_SCAN_RUNNING){WiFi.scanDelete();WiFi.scanNetworks(true);count=WIFI_SCAN_RUNNING;}
    if(count==WIFI_SCAN_RUNNING){portal.send(200,"application/json","{\"scanning\":true}");return;}
    if(count<0){portal.send(503,"application/json","{}");return;}
    DynamicJsonDocument doc(16384);JsonArray networks=doc.createNestedArray("networks");
    for(int i=0;i<count&&networks.size()<40;i++){
      String name=WiFi.SSID(i);if(!name.length())continue;
      bool duplicate=false;for(JsonObject n:networks)if(name==n["ssid"].as<String>()){duplicate=true;break;}
      if(duplicate)continue;JsonObject n=networks.createNestedObject();n["ssid"]=name;n["rssi"]=WiFi.RSSI(i);
    }
    String body;serializeJson(doc,body);portal.sendHeader("Cache-Control","no-store");portal.send(200,"application/json",body);
  });
  portal.on("/save",HTTP_POST,[]{
    if(portal.arg("csrf")!=csrf||portal.hostHeader()!="192.168.4.1"){portal.send(403,"text/plain","Invalid setup request");return;}
    String s=portal.arg("ssid"),w=portal.arg("wifi"),u=DEFAULT_URL,t=PRESET_DEVICE_TOKEN;u.trim();t.trim();while(u.endsWith("/"))u.remove(u.length()-1);
    bool tokenOk=t.length()>=32&&t.length()<=128;for(char c:t)if(c<33||c>126)tokenOk=false;
    if(s.length()<1||s.length()>32||w.length()<8||w.length()>63||!validOrigin(u)||!tokenOk){portal.send(400,"text/plain","Check WiFi, HTTPS origin and device token (32+ characters).");return;}
    StaticJsonDocument<1024> config;config["ssid"]=s;config["wifi"]=w;config["url"]=u;config["token"]=t;String raw;serializeJson(config,raw);
    if(!prefs.putString("config",raw)){portal.send(500,"text/plain","Could not save settings");return;}
    portal.send(200,"text/plain","Saved. Reconnect your phone to home WiFi. Device restarting.");delay(500);ESP.restart();
  });
  portal.onNotFound([]{portal.sendHeader("Location","http://192.168.4.1/",true);portal.send(302,"text/plain","");});portal.begin();
}
// FT6336U: point count at 0x02; first X/Y at 0x03..0x06.
int readTouch(int& x,int& y){
#ifdef CROWPANEL5
  static int heldX=0,heldY=0;static bool held=false;static uint32_t reportAt=0;
  auto readReg=[](uint16_t reg,uint8_t* out,size_t len){Wire.beginTransmission(0x5D);Wire.write(reg>>8);Wire.write(reg&255);if(Wire.endTransmission(false))return false;if(Wire.requestFrom(0x5D,int(len))!=len)return false;for(size_t i=0;i<len;i++)out[i]=Wire.read();return true;};
  uint8_t status;if(!readReg(0x814E,&status,1))return -1;
  if(!(status&0x80)){if(held&&millis()-reportAt<150){x=heldX;y=heldY;return 1;}held=false;return 0;}
  uint8_t point[5]={};int n=status&15;bool ok=n==1?readReg(0x814F,point,5):true;
  Wire.beginTransmission(0x5D);Wire.write(0x81);Wire.write(0x4E);Wire.write(0);Wire.endTransmission();
  if(!ok||n>1){held=false;return -1;}held=n==1;reportAt=millis();if(!held)return 0;
  x=point[1]|(point[2]<<8);y=point[3]|(point[4]<<8);if(x>=SCREEN_W||y>=SCREEN_H){held=false;return -1;}heldX=x;heldY=y;return 1;
#else
  Wire.beginTransmission(0x38);Wire.write(0x02);if(Wire.endTransmission(false))return -1;
  if(Wire.requestFrom(0x38,5)!=5)return -1;
  uint8_t n=Wire.read()&15,xh=Wire.read(),xl=Wire.read(),yh=Wire.read(),yl=Wire.read();
  if(!n)return 0;if(n!=1)return -1;
  int px=((xh&15)<<8)|xl,py=((yh&15)<<8)|yl;if(px>=320||py>=480)return -1;
  x=py;y=319-px;if(TOUCH_FLIP_X)x=479-x;if(TOUCH_FLIP_Y)y=319-y;return 1;
#endif
}
void touchLoop(){
  static bool active=false,cancelled=false;static int sx,sy,lx,ly;static uint32_t began;
  int x,y;int state=readTouch(x,y);
  if(state<0){if(active)cancelled=true;return;}
  if(state==1){if(!active){active=true;cancelled=false;sx=x;sy=y;began=millis();}lx=x;ly=y;return;}
  if(!active)return;active=false;if(cancelled||millis()-began>2000)return;
  int dx=lx-sx,dy=ly-sy;if(max(abs(dx),abs(dy))<30)return;
  Serial.printf("[gesture] dx=%d dy=%d\n",dx,dy);
  if(abs(dx)>abs(dy)*1.2){
    String target=shiftDate(selectedDate,dx<0?1:-1);
    if(target.length()){selectedDate=target;followTomorrow=false;page=0;transitionAxis=1;transitionDirection=dx<0?1:-1;redraw=true;}
  }else if(abs(dy)>abs(dx)*1.2){JsonObject rows[64];int last=max(0,(dayEvents(rows)-1)/PER_PAGE);int target=constrain(page+(dy<0?1:-1),0,last);if(target!=page){page=target;transitionAxis=2;transitionDirection=dy<0?1:-1;redraw=true;}}
}
void setup(){
  Serial.begin(115200);setenv("TZ",TZ_LONDON,1);tzset();pinMode(SETUP_BUTTON,INPUT_PULLUP);
#ifdef CROWPANEL5
  Wire.begin(TP_SDA,TP_SCL);Wire.setClock(100000);Wire.setTimeOut(30);delay(100);
  // V1.2/V1.3 official startup backlight command.
  Wire.beginTransmission(0x30);Wire.write(0);int lightResult=Wire.endTransmission();
  Serial.printf("[panel] controller=%d psram=%u\n",lightResult,ESP.getPsramSize());
  if(!gfx->begin()){Serial.println("[panel] initialization failed");while(true)delay(1000);}
#else
  pinMode(SD_CS,OUTPUT);digitalWrite(SD_CS,HIGH);gfx->begin(27000000);pinMode(LCD_BL,OUTPUT);digitalWrite(LCD_BL,HIGH);
#endif
  gfx->setTextWrap(false);gfx->fillScreen(BG);
  if(!psramFound()){textAt(15,60,"PSRAM not detected",2);textAt(15,100,"Check N16R8 / OPI PSRAM build.");gfx->flush();while(true)delay(1000);}
  snapshotPtr=new Document(MAX_BODY);
  agendaCanvas=new PlannerCanvas();
  if(!agendaCanvas->begin()){delete agendaCanvas;agendaCanvas=nullptr;}
  previousFrame=(uint16_t*)heap_caps_malloc(SCREEN_W*SCREEN_H*2,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);
  transitionFrame=(uint16_t*)heap_caps_malloc(SCREEN_W*ANIM_H*2,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);
#ifndef CROWPANEL5
  pinMode(TP_RST,OUTPUT);digitalWrite(TP_RST,LOW);delay(20);digitalWrite(TP_RST,HIGH);delay(200);
  Wire.begin(TP_SDA,TP_SCL);Wire.setClock(100000);Wire.setTimeOut(30);
#endif
  Serial.printf("[display] %dx%d canvas=%d animation=%d psramFree=%u\n",SCREEN_W,SCREEN_H,agendaCanvas!=nullptr,previousFrame&&transitionFrame,ESP.getFreePsram());
#ifdef CROWPANEL5
  delay(500);Wire.beginTransmission(0x30);Wire.write(0x10);Serial.printf("[backlight] late enable=%d\n",Wire.endTransmission());
#endif
  filesLock=xSemaphoreCreateMutex();fsReady=LittleFS.begin(false,"/littlefs",10,"littlefs");
  prefs.begin("planner",false);
  // Do not auto-format previously initialized storage on a mount error.
  if(!fsReady&&!prefs.getBool("fsReady",false)){fsReady=LittleFS.format()&&LittleFS.begin(false,"/littlefs",10,"littlefs");}
  if(fsReady)prefs.putBool("fsReady",true);
  StaticJsonDocument<1024> config;deserializeJson(config,prefs.getString("config","{}"));
  ssid=config["ssid"]|"";wifiPass=config["wifi"]|"";deviceToken=PRESET_DEVICE_TOKEN;backendUrl=DEFAULT_URL;
  // Apply changed build-time Wi-Fi once; later portal changes remain usable.
  if(strlen(PRESET_WIFI_SSID)&&prefs.getString("presetId","")!=PRESET_WIFI_ID){
    ssid=PRESET_WIFI_SSID;wifiPass=PRESET_WIFI_PASSWORD;
    config["ssid"]=ssid;config["wifi"]=wifiPass;config["url"]=backendUrl;config["token"]=deviceToken;
    String raw;serializeJson(config,raw);
    if(prefs.putString("config",raw))prefs.putString("presetId",PRESET_WIFI_ID);
  }
  loadCache();selectedDate=shiftDate(snapshot["coverageStart"]|"2026-01-01",1);
  bool forcedSetup=prefs.getBool("setup",false);prefs.remove("setup");
  if(forcedSetup||!ssid.length()||deviceToken.length()<32){setupPortal();return;}
  WiFi.onEvent([](WiFiEvent_t event,WiFiEventInfo_t info){if(event==ARDUINO_EVENT_WIFI_STA_DISCONNECTED)Serial.printf("[wifi] disconnect reason=%u\n",info.wifi_sta_disconnected.reason);if(event==ARDUINO_EVENT_WIFI_STA_GOT_IP)Serial.println("[wifi] IP acquired");});
  WiFi.persistent(false);WiFi.mode(WIFI_STA);WiFi.setAutoReconnect(true);WiFi.begin(ssid.c_str(),wifiPass.c_str());
  sntp_set_time_sync_notification_cb([](struct timeval*){clockValid=true;});
  configTzTime(TZ_LONDON,"pool.ntp.org","time.cloudflare.com");
  xTaskCreatePinnedToCore(networkTask,"network",16384,nullptr,1,nullptr,0);
}
void loop(){
#ifdef CROWPANEL5
  if(Serial.available()){
    char command=Serial.read();
    if(command=='b'||command=='B'){
      uint8_t value=command=='b'?0x10:0;
      Wire.beginTransmission(0x30);Wire.write(value);int result=Wire.endTransmission();
      Serial.printf("[backlight] command=%u result=%d\n",value,result);
    }
    if(command=='t'){
      gfx->fillScreen(0xFFFF);textAt(70,100,"DISPLAY TEST",4,0);gfx->flush();
      Serial.println("[display] white test shown");lastFrame=millis();redraw=false;
    }
  }
#endif

  if(setupMode){gfx->flush();dns.processNextRequest();portal.handleClient();if(millis()-portalStarted>600000)ESP.restart();delay(3);return;}
  if(digitalRead(SETUP_BUTTON)==LOW){if(!bootHeld)bootHeld=millis();if(millis()-bootHeld>3000){prefs.putBool("setup",true);ESP.restart();}}else bootHeld=0;
  // Setup flag is consumed on restart (handled before networking below).
  if(cacheChanged){cacheChanged=false;loadCache();redraw=true;}
  if(followTomorrow&&clockValid){String tomorrow=shiftDate(dateOf(time(nullptr)),1);if(selectedDate!=tomorrow){selectedDate=tomorrow;page=0;redraw=true;}}
  touchLoop();
  static uint32_t diagnosticAt=0;if(millis()-diagnosticAt>10000){diagnosticAt=millis();Serial.printf("[status] wifi=%d clock=%d sync=%d fs=%d events=%u heap=%u\n",int(WiFi.status()),clockValid,networkState,fsReady,unsigned(snapshot["events"].size()),ESP.getFreeHeap());}
  if(redraw||millis()-lastFrame>60000){presentAgenda();redraw=false;lastFrame=millis();}
  delay(10);
}
