// Replace the OS picker only. A real, advancing MediaStream feeds both actual
// bundled person models. No camera, network, clock or worker results are mocked.
export async function installLiveWall(page) {
  await page.evaluate(async () => {
    const img = new Image(); img.src = document.querySelector('img.fw-frame').src; await img.decode();
    let left = 1, right = 3, frozen = false;
    window.setWall = (a,b) => { left=a; right=b; }; window.freezeWall = v => { frozen=v; };
    Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{ configurable:true, value:async ({audio}) => {
      if (audio !== false) throw Error('Unexpected audio capture');
      const c=document.createElement('canvas'); c.width=1600; c.height=450;
      const ctx=c.getContext('2d'); const stream=c.captureStream(0), track=stream.getVideoTracks()[0]; window.wallTrack=track;
      const draw=()=>{ if(frozen) return; [left,right].forEach((v,i)=>{
        if(v<0){ctx.fillRect(i*800,0,800,450);return;} ctx.drawImage(img,(v%2)*800,Math.floor(v/2)*450,800,450,i*800,0,800,450);
      }); track.requestFrame(); }; const timer=setInterval(()=>track.readyState === 'ended' ? clearInterval(timer) : draw(),200); draw();return stream;
    }});
  });
}
