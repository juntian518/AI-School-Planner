# ESP32-S3 家庭课表屏

首版固件已编译通过，尚未在实物上验证显示、触摸和网络。目标硬件：ESP32-S3 DevKitC-1 N16R8 + Waveshare 独立 3.5inch Capacitive Touch LCD（ST7796S / FT6336U）。不是 Waveshare 一体式 ESP32 显示板。

## 接线

断电接线。以下 GPIO 来自 Waveshare 对应 ESP32-S3 示例；请按屏幕背面信号名称连接，不按排线颜色猜测。

| 屏幕信号 | ESP32-S3 |
| --- | --- |
| VCC | 3V3 |
| GND | GND |
| LCD DIN / MOSI | GPIO 2 |
| LCD CLK / SCLK | GPIO 1 |
| LCD CS | GPIO 39 |
| LCD DC | GPIO 41 |
| LCD RST | GPIO 40 |
| LCD BL | GPIO 6 |
| LCD DOUT / MISO | GPIO 42 |
| TP SDA | GPIO 15 |
| TP SCL | GPIO 7 |
| TP RST | GPIO 16 |
| TP INT | GPIO 17 |
| SD CS | GPIO 38 |

不使用 SD 卡，但保持 SD CS 为高电平。触摸采用轮询。横屏分辨率 480×320；方向需实物确认，必要时修改 include/board.h 的 TOUCH_FLIP_X / TOUCH_FLIP_Y。

官方参考：[产品 Wiki](https://www.waveshare.com/wiki/3.5inch_Capacitive_Touch_LCD)、[ESP32-S3 示例](https://files.waveshare.com/wiki/3.5inch%20Capacitive%20Touch%20LCD/3.5inch_Capacitive_Touch_LCD_Demo_ESP32S3.zip)。

## 编译与烧录

在仓库根目录运行（Windows PowerShell，需 Python）：

```powershell
python -m venv firmware/tools/venv
./firmware/tools/venv/Scripts/python.exe -m pip install -r firmware/tools/requirements.txt
./firmware/tools/venv/Scripts/pio.exe run -d firmware
./firmware/tools/venv/Scripts/pio.exe device list
./firmware/tools/venv/Scripts/pio.exe run -d firmware -t upload --upload-port COM5
```

将 COM5 换成实际端口。连接开发板的数据 USB 接口；若无法进入下载模式，按住 BOOT，按一下 RESET，再松开 BOOT。上传结束后按 RESET。上传命令自动写入 bootloader、分区表及应用；不要把单独 firmware.bin 写到地址 0。

项目覆盖为 16 MB Flash、OPI PSRAM（8 MB）；PlatformIO 的通用板名仍可能显示 N8。设备未检测到 PSRAM 会在屏幕显示错误。构建时从 certifi 生成 CA 根证书，不包含任何私人密钥。日后更新 certifi 并重新编译可更新证书。

## 首次配置

1. 开机屏幕显示 SchoolPlanner 热点名称和本次随机热点密码。
2. 手机连接该热点，打开 http://192.168.4.1 。
3. 输入家庭 Wi-Fi 名称、密码、后端地址和 DEVICE_TOKEN，保存后自动重启。

默认后端为 https://ai-school-planner-backend.vercel.app 。只填写 Vercel 中的 DEVICE_TOKEN；无需学校密码、Supabase key、ADMIN_TOKEN 或 CRON_SECRET。支持 2.4 GHz Wi-Fi，配置页当前要求 8～63 字符的 Wi-Fi 密码。

配置保存在设备 NVS，普通重启无需重新输入。要换网络或设备密钥，在正常运行后长按 BOOT 3 秒重新进入配置。配置热点 10 分钟后关闭并重启；原配置只有在新配置保存时才覆盖。NVS 当前未启用 Flash 加密，能物理读取芯片的人可能提取配置。

## 操作与同步

- 默认明天；左滑下一天、右滑前一天。
- 上滑下一页课程、下滑上一页，每页 4 项；老师和教室直接显示。
- 启动时通过 NTP 校时，按英国夏令时转换 UTC。
- 每 15 分钟通过 HTTPS 获取 /api/device-snapshot，失败约 1 分钟后重试。
- 快照校验后写入 LittleFS；断网保留缓存，主缓存损坏时尝试备份。
- 显示数据来源、离线/过期/密钥错误，以及日期未同步状态。未覆盖日期不等于没有课。

断电后离线启动没有可靠时钟：显示 CLOCK UNVERIFIED，并从缓存起始日期的次日开始，联网校时后恢复明天。当前使用英文界面和内置拉丁字体，非拉丁字符显示问号；长文本省略。滑动到其他日期后保持选择，重启回到明天。

## 验证边界

已完成 PlatformIO 编译及后端接口测试。接线后仍需验证：屏幕方向/颜色、四个滑动方向、首次配网、TLS 连接、断网缓存、断电重启。尚未进行实机烧录或实现 OTA。
