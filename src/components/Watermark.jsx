import { useEffect, useRef, useState } from 'react';

/**
 * 会员登入后，在会员相关页面全程显示的满屏低密度浮水印。
 * 使用网站配色里完全没出现过的洋红色调（经过多次调整，目前透明度 0.15，
 * 比原本 0.02 的隐形设计再深一些，方便肉眼稍微能察觉，但维持原本的密度/字体大小，
 * 不会大到干扰阅读体验）。
 */
export default function Watermark({ text, active, zIndex }) {
  const [grid, setGrid] = useState({ count: 0, cols: 2 });
  const timerRef = useRef(null);
  const SITE_URL = 'Tradewithus888.com';

  useEffect(() => {
    function recompute() {
      const w = window.innerWidth * 1.4;
      const h = window.innerHeight * 1.4;
      const cellW = 95, cellH = 65;
      const cols = Math.max(2, Math.ceil(w / cellW));
      const rows = Math.max(2, Math.ceil(h / cellH));
      setGrid({ count: Math.min(cols * rows, 1500), cols });
    }
    recompute();
    window.addEventListener('resize', recompute);
    return () => window.removeEventListener('resize', recompute);
  }, []);

  if (!active || !text) return null;

  return (
    <div className="global-watermark" aria-hidden="true" style={zIndex ? { zIndex } : undefined}>
      <div className="global-watermark-inner" style={{ gridTemplateColumns: `repeat(${grid.cols}, 1fr)` }}>
        {Array.from({ length: grid.count }).map((_, i) => {
          const col = i % grid.cols;
          const row = Math.floor(i / grid.cols);
          // 3x3 一组的方形排列：正中间放网址，四周（含四角）都放会员信箱
          const isCenter = col % 3 === 1 && row % 3 === 1;
          return <span key={i} className={isCenter ? 'wm-url' : ''}>{isCenter ? SITE_URL : text}</span>;
        })}
      </div>
    </div>
  );
}
