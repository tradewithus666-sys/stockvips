import { useRef } from 'react';
import { uploadImage } from '../lib/storage';

// 轻量富文本编辑器：不依赖任何外部套件（离线环境装不了新包），
// 用浏览器原生 contentEditable + execCommand 实现粗体／上色／条列／插入图片，
// 存的是 HTML 字串，前台直接用 dangerouslySetInnerHTML 渲染。
// execCommand 虽然是旧版 API，但主流浏览器目前都还支援，对这种简单场景够用。
export default function RichTextEditor({ value, onChange }) {
  const ref = useRef(null);

  function exec(cmd, arg) {
    ref.current.focus();
    document.execCommand(cmd, false, arg);
    onChange(ref.current.innerHTML);
  }

  async function insertImage(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const url = await uploadImage(file, 'articles');
      exec('insertImage', url);
    } catch (err) {
      alert('上传失败：' + err.message);
    }
  }

  return (
    <div className="rte-wrap">
      <div className="rte-toolbar">
        <button type="button" onClick={() => exec('bold')}><b>B</b></button>
        <button type="button" onClick={() => exec('italic')}><i>I</i></button>
        <button type="button" onClick={() => exec('insertUnorderedList')}>• 列表</button>
        <input type="color" onChange={(e) => exec('foreColor', e.target.value)} title="文字颜色" />
        <label className="rte-img-btn">
          🖼 插入图片
          <input type="file" accept="image/*" onChange={insertImage} style={{ display: 'none' }} />
        </label>
      </div>
      <div
        ref={ref}
        className="rte-body"
        contentEditable
        suppressContentEditableWarning
        dangerouslySetInnerHTML={{ __html: value || '' }}
        onInput={(e) => onChange(e.currentTarget.innerHTML)}
      />
    </div>
  );
}
