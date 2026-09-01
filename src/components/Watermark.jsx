import { useEffect, useRef, useState } from 'react';

/**
 * 会员登入后，在会员相关页面全程显示的满屏浮水印。
 *
 * 【本次修改】原本设计成透明度 0.02 的隐形浮水印（肉眼几乎看不见，专门给截图外流后
 * 用技术手段还原追溯）。现在改成清楚可见的版本（字体加大、颜色加深），
 * 让会员一眼就能看到自己的 email 疊在画面上，从「事后追溯」改成「即时吓阻」的设计目的。
 *
 * 取舍：这样阅读体验会持续受到浮水印影响（不只是 PDF 那种「看完就关掉」的情境），
 * 但吓阻效果更直接——转发前就知道畫面上帶著自己的身份标记。
 */
export default function Watermark({ text, active, zIndex }) {
  const [grid, setGrid] = useState({ count: 0, cols: 2 });
  const timerRef = useRef(null);
  const SITE_URL = 'Tradewithus888.com';

  useEffect(() => {
    function recompute() {
      const w = window.innerWidth * 1.4;
      const h = window.innerHeight * 1.4;
      // 【本次修改】字体加大了，格子尺寸也跟着放大，避免相邻的浮水印文字彼此重叠、糊成一片
      const cellW = 220, cellH = 140;
      const cols = Math.max(2, Math.ceil(w / cellW));
      const rows = Math.max(2, Math.ceil(h / cellH));
      setGrid({ count: Math.min(cols * rows, 400), cols });
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
