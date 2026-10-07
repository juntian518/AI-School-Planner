#pragma once
#include <stdint.h>
#include <math.h>
// Independent implementation of short-window quadratic trajectory fitting.
// Inspired by AOSP VelocityTracker LSQ2; no Android code is copied.
struct GestureMotion {
  struct Sample {uint32_t t; float p;};
  Sample history[12]; int count=0;
  void clear(){count=0;}
  void add(uint32_t t,float p){
    if(count&&history[count-1].t==t)return;
    if(count==12){for(int i=1;i<12;i++)history[i-1]=history[i];count--;}
    history[count++]={t,p};
  }
  void estimate(uint32_t now,float& velocity,float& acceleration)const{
    velocity=acceleration=0;if(count<2||now-history[count-1].t>90)return;
    float m[3][4]={};int n=0;
    for(int i=0;i<count;i++){
      uint32_t age=history[count-1].t-history[i].t;if(age>100)continue;
      float x=-float(age)/100.0f,p=history[i].p-history[count-1].p;
      float powers[5]={1,x,x*x,x*x*x,x*x*x*x};
      for(int r=0;r<3;r++){for(int c=0;c<3;c++)m[r][c]+=powers[r+c];m[r][3]+=powers[r]*p;}n++;
    }
    if(n<3){auto a=history[count-2],b=history[count-1];velocity=(b.p-a.p)/float(b.t-a.t);return;}
    for(int k=0;k<3;k++){
      int pivot=k;for(int r=k+1;r<3;r++)if(fabsf(m[r][k])>fabsf(m[pivot][k]))pivot=r;
      if(fabsf(m[pivot][k])<.00001f)return;
      for(int c=k;c<4;c++){float v=m[k][c];m[k][c]=m[pivot][c];m[pivot][c]=v;}
      float d=m[k][k];for(int c=k;c<4;c++)m[k][c]/=d;
      for(int r=0;r<3;r++)if(r!=k){float f=m[r][k];for(int c=k;c<4;c++)m[r][c]-=f*m[k][c];}
    }
    velocity=fmaxf(-3,fminf(3,m[1][3]/100));
    acceleration=fmaxf(-.01f,fminf(.01f,2*m[2][3]/10000));
  }
};
inline bool gestureMotionSelfTest(){
  GestureMotion m;float v,a;
  for(int t=0;t<=100;t+=20)m.add(t,.8f*t);
  m.estimate(100,v,a);if(fabsf(v-.8f)>.01f||fabsf(a)>.0001f)return false;
  m.clear();for(int t=0;t<=100;t+=20)m.add(t,.2f*t+.002f*t*t);
  m.estimate(100,v,a);if(fabsf(v-.6f)>.01f||fabsf(a-.004f)>.0001f)return false;
  m.estimate(220,v,a);return v==0&&a==0;
}

// Do not choose an axis from a tap or a diagonal movement. Once chosen,
// the caller retains it until contact ends (including animation recapture).
inline int chooseDragAxis(int dx,int dy){
  int x=dx<0?-dx:dx,y=dy<0?-dy:dy;
  if(x>=14&&x*2>y*3)return 1;
  if(y>=14&&y*2>x*3)return 2;
  return 0;
}
inline bool gestureAxisSelfTest(){
  return chooseDragAxis(4,2)==0&&chooseDragAxis(30,29)==0&&
    chooseDragAxis(80,10)==1&&chooseDragAxis(-80,10)==1&&
    chooseDragAxis(10,80)==2&&chooseDragAxis(10,-80)==2;
}
