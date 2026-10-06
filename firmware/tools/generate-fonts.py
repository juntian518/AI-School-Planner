from pathlib import Path
import sys
large="--large" in sys.argv
target="smooth_font_large.h" if large else "smooth_font.h"
from PIL import Image,ImageDraw,ImageFont
out=['#pragma once','struct SmoothGlyph { uint32_t offset; uint8_t w,h,advance; int8_t x,y; };','struct SmoothFont { const uint8_t* alpha; const SmoothGlyph* glyphs; };']
for name,file,size in [('Small','segoeui.ttf',12),('Body','segoeui.ttf',16),('Title','segoeuib.ttf',20),('Heading','segoeuib.ttf',26)]:
 if large:size={'Small':16,'Body':22,'Title':26,'Heading':34}[name]
 font=ImageFont.truetype('C:/Windows/Fonts/'+file,size);data=[];glyphs=[]
 for code in range(32,127):
  ch=chr(code);x0,y0,x1,y1=font.getbbox(ch,anchor='ls');w=x1-x0;h=y1-y0
  im=Image.new('L',(max(1,w),max(1,h)));ImageDraw.Draw(im).text((-x0,-y0),ch,font=font,fill=255,anchor='ls')
  glyphs.append((len(data),w,h,round(font.getlength(ch)),x0,y0));data.extend(list(im.getdata()) if w*h else [])
 out+=['static const uint8_t '+name+'Alpha[] PROGMEM={'+','.join(map(str,data))+'};','static const SmoothGlyph '+name+'Glyphs[] PROGMEM={'+','.join('{'+','.join(map(str,g))+'}' for g in glyphs)+'};','static const SmoothFont '+name+'Font={'+name+'Alpha,'+name+'Glyphs};']
(Path('firmware/include') / target).write_text('\n'.join(out),encoding='ascii')
p=Path('.gitignore');s=p.read_text();
if 'firmware/include/smooth_font.h' not in s:p.write_text(s+'\nfirmware/include/smooth_font.h\n')
im=Image.open('firmware/assets/tiffin-crest.png').convert('RGBA').resize((38,38),Image.Resampling.LANCZOS);bg=Image.new('RGBA',im.size,(34,77,65,255));bg.alpha_composite(im);values=[((r&248)<<8)|((g&252)<<3)|(b>>3) for r,g,b,a in bg.getdata()];Path('firmware/include/tiffin_logo.h').write_text('#pragma once\nstatic const uint16_t TIFFIN_LOGO[] PROGMEM={'+','.join(hex(v) for v in values)+'};\n')
