# ESP32 固件（待实现）

用户已购硬件：ESP32-S3 DevKitC-1 N16R8、Waveshare 3.5inch Capacitive Touch LCD（320×480）。根据对应官方产品文档，显示为 ST7796S / SPI，触摸为 FT6336U / I²C。

目标：横屏 480×320，显示日期、当前课程、下一节课、教室、同步状态；触摸切换日期；离线保留已收到的课表。

本目录尚无可编译或烧录固件。接线需以实物丝印、屏幕版本及官方 ESP32-S3 示例为准，不根据商品缩略图指定供电与 GPIO。

后续固件只携带设备 API token，使用 HTTPS 验证服务端证书；开机 NTP 校时；保存 UTC 时间并按 Europe/London 转换。必须明显区分 demo、过期、日期未覆盖和当天无课。每隔 15～30 分钟获取课表，当前课程在设备端按时间更新。

官方参考：https://www.waveshare.com/wiki/3.5inch_Capacitive_Touch_LCD
