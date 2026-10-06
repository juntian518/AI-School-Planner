#pragma once
#ifdef CROWPANEL5
constexpr int SCREEN_W=800, SCREEN_H=480, PER_PAGE=4, ANIM_TOP=112, ANIM_H=312;
constexpr int TP_SDA=15, TP_SCL=16, SETUP_BUTTON=0;
#else
constexpr int SCREEN_W=480, SCREEN_H=320, PER_PAGE=3, ANIM_TOP=84, ANIM_H=192;
// Waveshare 3.5inch Capacitive Touch LCD official ESP32S3 example.
constexpr int LCD_MISO=42, LCD_MOSI=2, LCD_SCLK=1;
constexpr int LCD_CS=39, LCD_DC=41, LCD_RST=40, LCD_BL=6;
constexpr int TP_SDA=15, TP_SCL=7, TP_RST=16, TP_INT=17;
constexpr int SD_CS=38, SETUP_BUTTON=0;
constexpr bool TOUCH_FLIP_X=false, TOUCH_FLIP_Y=false;

#endif
