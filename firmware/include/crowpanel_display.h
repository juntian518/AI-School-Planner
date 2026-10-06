#pragma once
// Hardware configuration from Elecrow official BigInch_LVGL example.
#define LGFX_USE_V1
#include <LovyanGFX.hpp>
#include <lgfx/v1/platforms/esp32s3/Panel_RGB.hpp>
#include <lgfx/v1/platforms/esp32s3/Bus_RGB.hpp>
#include <driver/i2c.h>

class CrowPanelHardware : public lgfx::LGFX_Device {
public:

  lgfx::Bus_RGB _bus_instance;
  lgfx::Panel_RGB _panel_instance;
//  lgfx::Light_PWM _light_instance;
  lgfx::Touch_GT911 _touch_instance;

  CrowPanelHardware(void) {
    {
      auto cfg = _panel_instance.config();

      cfg.memory_width = 800;
      cfg.memory_height = 480;
      cfg.panel_width = 800;
      cfg.panel_height = 480;

      cfg.offset_x = 0;
      cfg.offset_y = 0;

      _panel_instance.config(cfg);
    }

    {
      auto cfg = _panel_instance.config_detail();

      cfg.use_psram = 1;

      _panel_instance.config_detail(cfg);
    }

    {
      auto cfg = _bus_instance.config();
      cfg.panel = &_panel_instance;
      cfg.pin_d0 = GPIO_NUM_21;    // B0
      cfg.pin_d1 = GPIO_NUM_47;    // B1
      cfg.pin_d2 = GPIO_NUM_48;   // B2
      cfg.pin_d3 = GPIO_NUM_45;    // B3
      cfg.pin_d4 = GPIO_NUM_38;    // B4
      cfg.pin_d5 = GPIO_NUM_9;    // G0
      cfg.pin_d6 = GPIO_NUM_10;    // G1
      cfg.pin_d7 = GPIO_NUM_11;    // G2
      cfg.pin_d8 = GPIO_NUM_12;   // G3
      cfg.pin_d9 = GPIO_NUM_13;   // G4
      cfg.pin_d10 = GPIO_NUM_14;   // G5
      cfg.pin_d11 = GPIO_NUM_7;  // R0
      cfg.pin_d12 = GPIO_NUM_17;  // R1
      cfg.pin_d13 = GPIO_NUM_18;  // R2
      cfg.pin_d14 = GPIO_NUM_3;  // R3
      cfg.pin_d15 = GPIO_NUM_46;  // R4

      cfg.pin_henable = GPIO_NUM_42;
      cfg.pin_vsync = GPIO_NUM_41;
      cfg.pin_hsync = GPIO_NUM_40;
      cfg.pin_pclk = GPIO_NUM_39;
      cfg.freq_write = 16000000;

      cfg.hsync_polarity = 0;
      cfg.hsync_front_porch = 8;
      cfg.hsync_pulse_width = 4;
      cfg.hsync_back_porch = 8;
      cfg.vsync_polarity = 0;
      cfg.vsync_front_porch = 8;
      cfg.vsync_pulse_width = 4;
      cfg.vsync_back_porch = 8;
      cfg.pclk_idle_high = 1;

      _bus_instance.config(cfg);
    }
    _panel_instance.setBus(&_bus_instance);


    setPanel(&_panel_instance);
  }
};

// Keep the existing canvas renderer while using the vendor-recommended RGB driver.
class CrowPanelDisplay : public Arduino_GFX {
  CrowPanelHardware panel;
 public:
  CrowPanelDisplay():Arduino_GFX(800,480){}
  bool begin(int32_t speed=GFX_NOT_DEFINED) override {panel.init();panel.setColorDepth(16);return true;}
  void writePixelPreclipped(int16_t x,int16_t y,uint16_t color) override {panel.drawPixel(x,y,color);}
  void writeFillRectPreclipped(int16_t x,int16_t y,int16_t w,int16_t h,uint16_t color) override {panel.fillRect(x,y,w,h,color);}
  void draw16bitRGBBitmap(int16_t x,int16_t y,uint16_t* pixels,int16_t w,int16_t h) override {panel.pushImage(x,y,w,h,reinterpret_cast<lgfx::rgb565_t*>(pixels));}
};
