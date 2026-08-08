import { useEffect, useRef } from 'react';
import { uploadImage } from '../lib/storage';

// 轻量富文本编辑器：不依赖任何外部套件（离线环境装不了新包），
// 用浏览器原生 contentEditable + execCommand 实现粗体／上色／条列／插入图片，
// 存的是 HTML 字串，前台直接用 dangerouslySetInnerHTML 渲染。
//
// 重要：这里刻意做成「非受控」元件——innerHTML 只在初次挂载、或 value 从外部被换成
// 完全不同内容时才写入 DOM，使用者打字过程中绝对不会再被 dangerouslySetInnerHTML 覆盖。
// 之前的 bug 就是每打一个字都用 React state 重新设定整个 innerHTML，把游标冲回最前面，
// 变成打字一直往前插入、视觉上像是反过来的效果。
export default function RichTextEditor({ value, onChange }) {
  const ref = useRef(null);
  const lastValueRef = useRef(value); // 记录「目前 DOM 里实际内容对应的 value」，跟外部传入的 value 比对

  useEffect(() => {
    if (!ref.current) return;
    // 只有当外部传入的 value 跟我们自己上次同步出去的不一样时，才代表是「外部换了一份新内容」
    // （例如切换到编辑不同一篇文章/不同选项），这时候才需要重设 DOM；使用者自己打字触发的
    // onChange 不会造成这个差异，所以不会在打字过程中被打断。
    if (value !== lastValueRef.current) {
      ref.current.innerHTML = value || '';
      lastValueRef.current = value;
    }
  }, [value]);

  function handleInput(e) {
    const html = e.currentTarget.innerHTML;
    lastValueRef.current = html;
    onChange(html);
  }

  function exec(cmd, arg) {
    ref.current.focus();
    document.execCommand(cmd, false, arg);
    handleInput({ currentTarget: ref.current });
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
        onInput={handleInput}
      />
    </div>
  );
}
