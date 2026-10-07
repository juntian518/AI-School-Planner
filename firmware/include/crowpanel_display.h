#pragma once
#include <esp_lcd_panel_ops.h>
#include <esp_lcd_panel_rgb.h>

// Elecrow Advance 5-inch RGB565 pinout, with ESP-IDF internal DMA bounce buffers.
// The LCD reads internal SRAM instead of contending directly with Wi-Fi for PSRAM.
class CrowPanelDisplay : public Arduino_Canvas {
  esp_lcd_panel_handle_t panel=nullptr;
  uint16_t* buffers[2]={nullptr,nullptr};
  int drawing=1;
  SemaphoreHandle_t frameDone=nullptr;
  volatile bool pending=false;
  static bool IRAM_ATTR frameFinished(esp_lcd_panel_handle_t,const esp_lcd_rgb_panel_event_data_t*,void* context){
    auto* self=static_cast<CrowPanelDisplay*>(context);BaseType_t wake=pdFALSE;
    if(self->pending){self->pending=false;xSemaphoreGiveFromISR(self->frameDone,&wake);}
    return wake==pdTRUE;
  }
 public:
  CrowPanelDisplay():Arduino_Canvas(800,480,nullptr){}
  bool begin(int32_t speed=GFX_NOT_DEFINED) override {
    esp_lcd_rgb_panel_config_t c={};
    c.clk_src=LCD_CLK_SRC_DEFAULT;
    c.timings.pclk_hz=16000000;c.timings.h_res=800;c.timings.v_res=480;
    c.timings.hsync_pulse_width=4;c.timings.hsync_back_porch=8;c.timings.hsync_front_porch=8;
    c.timings.vsync_pulse_width=4;c.timings.vsync_back_porch=8;c.timings.vsync_front_porch=8;
    c.timings.flags.hsync_idle_low=true;c.timings.flags.vsync_idle_low=true;
    c.timings.flags.pclk_active_neg=true;
    c.timings.flags.pclk_idle_high=true;
    c.data_width=16;c.bits_per_pixel=16;c.num_fbs=2;
    c.bounce_buffer_size_px=800*20;
    c.sram_trans_align=4;c.psram_trans_align=64;
    c.hsync_gpio_num=40;c.vsync_gpio_num=41;c.de_gpio_num=42;c.pclk_gpio_num=39;c.disp_gpio_num=-1;
    const int pins[16]={21,47,48,45,38,9,10,11,12,13,14,7,17,18,3,46};
    for(int i=0;i<16;i++)c.data_gpio_nums[i]=pins[i];
    c.flags.fb_in_psram=true;
    esp_err_t result=esp_lcd_new_rgb_panel(&c,&panel);
    frameDone=xSemaphoreCreateBinary();
    if(!frameDone)return false;
    esp_lcd_rgb_panel_event_callbacks_t callbacks={};callbacks.on_bounce_frame_finish=frameFinished;
    if(result==ESP_OK)result=esp_lcd_rgb_panel_register_event_callbacks(panel,&callbacks,this);
    if(result==ESP_OK)result=esp_lcd_panel_reset(panel);
    if(result==ESP_OK)result=esp_lcd_panel_init(panel);
    void* first=nullptr;void* second=nullptr;
    if(result==ESP_OK)result=esp_lcd_rgb_panel_get_frame_buffer(panel,2,&first,&second);
    buffers[0]=static_cast<uint16_t*>(first);buffers[1]=static_cast<uint16_t*>(second);
    _framebuffer=buffers[drawing];
    Serial.printf("[rgb] driver=%s bounceLines=20 doubleBuffer=1 clock=16MHz\n",esp_err_to_name(result));
    return result==ESP_OK&&_framebuffer;
  }
  void flush() override { present(true); }
  void present(bool copyChrome) {
    if(!panel||!_framebuffer)return;
    while(xSemaphoreTake(frameDone,0)==pdTRUE){}
    esp_lcd_panel_draw_bitmap(panel,0,0,800,480,_framebuffer);
    pending=true;
    if(xSemaphoreTake(frameDone,pdMS_TO_TICKS(200))!=pdTRUE){Serial.println("[rgb] frame switch timeout");return;}
    uint16_t* shown=_framebuffer;drawing^=1;_framebuffer=buffers[drawing];
    // Keep the stable header/footer; course animation overwrites the middle directly.
    // Stage through SRAM to avoid PSRAM source/destination cache-set thrashing.
    if(!copyChrome)return;
    static uint16_t line[800];
    for(int y=0;y<480;y++)if(y<112||y>=424){
      memcpy(line,shown+y*800,sizeof(line));memcpy(_framebuffer+y*800,line,sizeof(line));
    }
  }
};
