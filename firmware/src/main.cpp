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
Arduino_DataBus* bus=new Arduino_ESP32SPI(LCD_DC,LCD_CS,LCD_SCLK,LCD_MOSI,LCD_MISO,FSPI);
Arduino_GFX* gfx=new Arduino_ST7796(bus,LCD_RST,1,true,320,480);
Preferences prefs;
WebServer portal(80);
DNSServer dns;
SemaphoreHandle_t filesLock;
String ssid,wifiPass,deviceToken,backendUrl,selectedDate,csrf,apPassword;
volatile bool clockValid=false,cacheChanged=false;
volatile int networkState=0; // 0 starting, 1 OK, 2 offline, 3 auth, 4 TLS/network, 5 data, 6 waiting clock
bool fsReady=false,setupMode=false,redraw=true,followTomorrow=true;
int page=0;
uint32_t lastFrame=0,portalStarted=0,bootHeld=0;
const char* TZ_LONDON="GMT0BST,M3.5.0/1,M10.5.0";

String randomHex(size_t bytes){String result; const char h[]="0123456789abcdef";for(size_t i=0;i<bytes;i++){uint8_t b=esp_random();result+=h[b>>4];result+=h[b&15];}return result;}
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
  gfx->setTextSize(size);gfx->setTextColor(color);gfx->setCursor(x,y);gfx->print(ascii);
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
    if(!err&&validSnapshot(candidate)){snapshot=candidate;break;}
  }
  xSemaphoreGive(filesLock);
}
int dayEvents(JsonObject* rows){int count=0;for(JsonObject e:snapshot["events"].as<JsonArray>()){if(dateOf(parseUtc(e["start"]))==selectedDate){if(count<64)rows[count++]=e;}}return count;}
void drawAgenda(){
  gfx->fillScreen(BG);
  textAt(16,12,selectedDate,2);
  textAt(375,14,snapshot["source"]|"NO DATA",1,FG,16);
  String tomorrow=clockValid?shiftDate(dateOf(time(nullptr)),1):"";
  textAt(16,40,selectedDate==tomorrow?"Tomorrow":"School plans",3);
  JsonObject rows[64];int count=dayEvents(rows);int pages=max(1,(count+3)/4);page=constrain(page,0,pages-1);
  String week=count?String(rows[0]["week"]|""):"";
  textAt(16,72,String(count)+" activities"+(week.length()?"  |  Week "+week:""));
  bool covered=snapshot.size() && selectedDate>=String(snapshot["coverageStart"]|"") && selectedDate<=String(snapshot["coverageEnd"]|"");
  if(!count){textAt(16,135,covered?"No activities scheduled":"Date not synchronized",2);if(!covered)textAt(16,165,"This does not mean there are no lessons.");}
  for(int i=page*4;i<min(count,(page+1)*4);i++){
    int y=96+(i%4)*44;JsonObject e=rows[i];
    textAt(12,y+5,localTime(e["start"])+"-"+localTime(e["end"]),1);
    textAt(90,y,shortTitle(e["title"]|""),2,FG,26);
    textAt(90,y+22,e["staff"]|"Teacher not provided",1,MUTED,48);
    textAt(413,y+5,e["location"]|"--",1,FG,9);
    gfx->drawFastHLine(12,y+40,456,0xBD92);
  }
  String status;
  if(!clockValid)status="CLOCK UNVERIFIED - connect WiFi";
  else if(networkState==3)status="ACCESS KEY REJECTED - hold BOOT to setup";
  else if(networkState==2)status="OFFLINE - saved timetable";
  else if(networkState>=4)status="SYNC FAILED - saved timetable";
  else status="WiFi connected";
  if(snapshot.size()&&clockValid&&time(nullptr)-parseUtc(snapshot["receivedAt"])>3600)status="STALE CACHE | "+status;
  textAt(12,282,status,1,MUTED,67);
  textAt(12,302,"< > Day    Swipe up/down: page",1,MUTED);
  textAt(422,300,String(page+1)+"/"+pages,1);
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
  if(code!=200){networkState=(code==401||code==403)?3:4;http.end();return false;}
  if(http.getSize()>int(MAX_BODY)){networkState=5;http.end();return false;}
  xSemaphoreTake(filesLock,portMAX_DELAY);
  File temp=LittleFS.open("/snapshot.tmp","w");
  if(!temp){xSemaphoreGive(filesLock);http.end();networkState=5;return false;}
  LimitedFile output(temp);int bytes=http.writeToStream(&output);output.flush();temp.close();http.end();
  bool ok=bytes>0&&!output.exceeded;
  Document candidate(MAX_BODY);
  if(ok){File f=LittleFS.open("/snapshot.tmp","r");ok=!deserializeJson(candidate,f)&&validSnapshot(candidate);f.close();}
  if(ok){
    if(LittleFS.exists("/snapshot.json")){
      LittleFS.remove("/snapshot.bak");ok=LittleFS.rename("/snapshot.json","/snapshot.bak");
    }
    if(ok)ok=LittleFS.rename("/snapshot.tmp","/snapshot.json");
  }
  if(!ok)LittleFS.remove("/snapshot.tmp");
  xSemaphoreGive(filesLock);
  networkState=ok?1:5;if(ok)cacheChanged=true;return ok;
}
void networkTask(void*){
  uint32_t lastTry=0;bool first=true;
  for(;;){
    if(WiFi.status()!=WL_CONNECTED){networkState=2;WiFi.reconnect();vTaskDelay(pdMS_TO_TICKS(10000));continue;}
    if(!clockValid){networkState=6;vTaskDelay(pdMS_TO_TICKS(1000));continue;}
    uint32_t interval=networkState==1?15*60*1000:60*1000;
    if(first||uint32_t(millis()-lastTry)>=interval){first=false;lastTry=millis();downloadSnapshot();}
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
  setupMode=true;portalStarted=millis();csrf=randomHex(16);apPassword=randomHex(6);
  WiFi.mode(WIFI_AP);String ap="SchoolPlanner-"+String(uint32_t(ESP.getEfuseMac()),HEX).substring(0,6);
  WiFi.softAP(ap.c_str(),apPassword.c_str(),1,false,1);dns.start(53,"*",WiFi.softAPIP());
  gfx->fillScreen(BG);textAt(15,20,"First-time setup",3);textAt(15,72,"Connect phone to WiFi:",2);textAt(15,103,ap,2);
  textAt(15,145,"WiFi password: "+apPassword,2);textAt(15,195,"Open http://192.168.4.1",2);textAt(15,255,"Hold BOOT 3 seconds to reopen setup.");textAt(15,278,"Setup closes after 10 minutes.");
  portal.on("/",HTTP_GET,[]{
    String html=R"HTML(<!doctype html><meta name="viewport" content="width=device-width"><title>School Planner setup</title><style>body{font:16px sans-serif;max-width:440px;margin:30px auto;padding:16px}input,button{box-sizing:border-box;width:100%;padding:12px;margin:8px 0 18px}</style><h1>School Planner</h1><p>Settings stay on this device.</p><form method="post" action="/save"><label>Home WiFi name<input name="ssid" maxlength="32" required></label><label>WiFi password<input name="wifi" type="password" minlength="8" maxlength="63" required></label><label>Backend URL<input name="url" value="https://ai-school-planner-backend.vercel.app" required></label><label>Device token<input name="token" type="password" minlength="32" maxlength="128" required></label><input type="hidden" name="csrf" value=")HTML";
    html+=csrf+"\"><button>Save and restart</button></form>";
    portal.sendHeader("Cache-Control","no-store");portal.send(200,"text/html",html);
  });
  portal.on("/save",HTTP_POST,[]{
    if(portal.arg("csrf")!=csrf||portal.hostHeader()!="192.168.4.1"){portal.send(403,"text/plain","Invalid setup request");return;}
    String s=portal.arg("ssid"),w=portal.arg("wifi"),u=portal.arg("url"),t=portal.arg("token");u.trim();t.trim();while(u.endsWith("/"))u.remove(u.length()-1);
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
  Wire.beginTransmission(0x38);Wire.write(0x02);if(Wire.endTransmission(false))return -1;
  if(Wire.requestFrom(0x38,5)!=5)return -1;
  uint8_t n=Wire.read()&15,xh=Wire.read(),xl=Wire.read(),yh=Wire.read(),yl=Wire.read();
  if(!n)return 0;if(n!=1)return -1;
  int px=((xh&15)<<8)|xl,py=((yh&15)<<8)|yl;if(px>=320||py>=480)return -1;
  x=py;y=319-px;if(TOUCH_FLIP_X)x=479-x;if(TOUCH_FLIP_Y)y=319-y;return 1;
}
void touchLoop(){
  static bool active=false,cancelled=false;static int sx,sy,lx,ly;static uint32_t began;
  int x,y;int state=readTouch(x,y);
  if(state<0){if(active)cancelled=true;return;}
  if(state==1){if(!active){active=true;cancelled=false;sx=x;sy=y;began=millis();}lx=x;ly=y;return;}
  if(!active)return;active=false;if(cancelled||millis()-began>2000)return;
  int dx=lx-sx,dy=ly-sy;if(max(abs(dx),abs(dy))<30)return;
  if(abs(dx)>abs(dy)*1.2){
    String target=shiftDate(selectedDate,dx<0?1:-1);
    if(target.length()){selectedDate=target;followTomorrow=false;page=0;redraw=true;}
  }else if(abs(dy)>abs(dx)*1.2){page=max(0,page+(dy<0?1:-1));redraw=true;}
}
void setup(){
  Serial.begin(115200);setenv("TZ",TZ_LONDON,1);tzset();pinMode(SETUP_BUTTON,INPUT_PULLUP);
  pinMode(SD_CS,OUTPUT);digitalWrite(SD_CS,HIGH);gfx->begin(27000000);pinMode(LCD_BL,OUTPUT);digitalWrite(LCD_BL,HIGH);
  gfx->setTextWrap(false);gfx->fillScreen(BG);
  if(!psramFound()){textAt(15,60,"PSRAM not detected",2);textAt(15,100,"Check N16R8 / OPI PSRAM build.");while(true)delay(1000);}
  snapshotPtr=new Document(MAX_BODY);
  pinMode(TP_RST,OUTPUT);digitalWrite(TP_RST,LOW);delay(20);digitalWrite(TP_RST,HIGH);delay(200);
  Wire.begin(TP_SDA,TP_SCL);Wire.setClock(100000);Wire.setTimeOut(30);
  filesLock=xSemaphoreCreateMutex();fsReady=LittleFS.begin(false);
  prefs.begin("planner",false);
  // Do not auto-format previously initialized storage on a mount error.
  if(!fsReady&&!prefs.getBool("fsReady",false)){fsReady=LittleFS.format()&&LittleFS.begin(false);}
  if(fsReady)prefs.putBool("fsReady",true);
  StaticJsonDocument<1024> config;deserializeJson(config,prefs.getString("config","{}"));
  ssid=config["ssid"]|"";wifiPass=config["wifi"]|"";deviceToken=config["token"]|"";backendUrl=config["url"]|DEFAULT_URL;
  loadCache();selectedDate=shiftDate(snapshot["coverageStart"]|"2026-01-01",1);
  bool forcedSetup=prefs.getBool("setup",false);prefs.remove("setup");
  if(forcedSetup||!ssid.length()||deviceToken.length()<32){setupPortal();return;}
  WiFi.persistent(false);WiFi.mode(WIFI_STA);WiFi.setAutoReconnect(true);WiFi.begin(ssid.c_str(),wifiPass.c_str());
  sntp_set_time_sync_notification_cb([](struct timeval*){clockValid=true;});
  configTzTime(TZ_LONDON,"pool.ntp.org","time.cloudflare.com");
  xTaskCreatePinnedToCore(networkTask,"network",16384,nullptr,1,nullptr,0);
}
void loop(){
  if(setupMode){dns.processNextRequest();portal.handleClient();if(millis()-portalStarted>600000)ESP.restart();delay(3);return;}
  if(digitalRead(SETUP_BUTTON)==LOW){if(!bootHeld)bootHeld=millis();if(millis()-bootHeld>3000){prefs.putBool("setup",true);ESP.restart();}}else bootHeld=0;
  // Setup flag is consumed on restart (handled before networking below).
  if(cacheChanged){cacheChanged=false;loadCache();redraw=true;}
  if(followTomorrow&&clockValid){String tomorrow=shiftDate(dateOf(time(nullptr)),1);if(selectedDate!=tomorrow){selectedDate=tomorrow;page=0;redraw=true;}}
  touchLoop();
  if(redraw||millis()-lastFrame>60000){drawAgenda();redraw=false;lastFrame=millis();}
  delay(10);
}
