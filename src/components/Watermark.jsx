import { useEffect, useRef, useState } from 'react';

/**
 * 会员登入后，在会员相关页面全程显示的满屏低密度浮水印。
 * 使用网站配色里完全没出现过的洋红色调，透明度 0.02（经过实测比较：0.03 在纯白背景下用肉眼仔细看
 * 还是能察觉到极淡的斜纹字样，0.02 已经很难用肉眼分辨，属于「肉眼不可见 vs 抗压缩重存」两者间偏向
 * 不可见的取舍点）。不用 mix-blend-mode，改用一般透明度合成，色偏量固定可预期，
 * 之后可以用「R、B 通道数值相对 G 通道偏高」这个特征去还原（不需要极端调对比度）。
 *
 * 已知取舍（如实记录，供之后调整参考）：
 * 透明度愈低愈接近肉眼不可见，但也愈容易被外部的破坏性压缩（例如 WhatsApp/Telegram 自动压缩、
 * 或存成较低品质的 JPEG）直接抹除信号，两者无法同时做到最佳。目前 0.02 是实测后偏向「肉眼不可见」
 * 的选择，对于原始 PNG 截图或压缩程度温和的 JPEG 仍可还原，但如果外泄图片被压得很严重，
 * 有可能连这层视觉浮水印都读不出来——这种情况下要靠另一套「零宽字元文字浮水印」
 * （用于外泄的是文字内容而非截图时）来追溯来源。
 */
export default function Watermark({ text, active }) {
  const [grid, setGrid] = useState({ count: 0, cols: 2 });
  const timerRef = useRef(null);
  const SITE_URL = 'Tradewithus888.com';

  useEffect(() => {
    function recompute() {
      const w = window.innerWidth * 1.4;
      const h = window.innerHeight * 1.4;
      const cellW = 140, cellH = 95;
      const cols = Math.max(2, Math.ceil(w / cellW));
      const rows = Math.max(2, Math.ceil(h / cellH));
      setGrid({ count: Math.min(cols * rows, 900), cols });
    }
    recompute();
    window.addEventListener('resize', recompute);
    return () => window.removeEventListener('resize', recompute);
  }, []);

  if (!active || !text) return null;

  return (
    <div className="global-watermark" aria-hidden="true">
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
