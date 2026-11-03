import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { PASTE_COMMAND, COMMAND_PRIORITY_CRITICAL, $insertNodes } from 'lexical';
import { $createImageNode } from '../nodes/ImageNode';
import { uploadImage, imageFailureMessage } from '../utils/imageUpload';
import { useImageUploadSession } from '../hooks/useImageUploadSession';
import { toast } from '~/services/toast';

export default function PasteImagePlugin({ documentId } = {}) {
    const [editor] = useLexicalComposerContext();
    const { begin } = useImageUploadSession(editor, documentId);
    useEffect(() => editor.registerCommand(PASTE_COMMAND, event => {
        if (!editor.isEditable()) return false;
        const files = Array.from(event.clipboardData?.files || []).filter(file => file.type.startsWith('image/'));
        if (!files.length) return false;
        const task = begin();
        event.preventDefault?.();
        if (!task) { toast.warning('图片正在处理中，请稍后再粘贴'); return true; }
        const closeLoading = toast.loading('正在插入粘贴的图片…');
        task.signal.addEventListener('abort', closeLoading, { once: true });
        (async () => {
            const items = [];
            let failed = [], originalOnly = 0;
            try {
                for (const file of files) {
                    if (!task.current()) break;
                    try {
                        const item = await uploadImage(file, { signal: task.signal, isCurrent: task.current });
                        items.push(item);
                        if (item.originalOnly) originalOnly++;
                    } catch (error) {
                        if (!task.current() || error?.name === 'AbortError') break;
                        failed.push(file.name);
                    }
                }
                if (!task.current()) return;
                if (items.length) editor.update(() => {
                    if (!task.current()) return;
                    $insertNodes(items.map(item => $createImageNode({ src: item.src, originalSrc: item.originalSrc, alt: item.alt, width: 500 })));
                });
                if (failed.length) toast.error(imageFailureMessage(items.length, failed, '粘贴'));
                else if (originalOnly) toast.warning('压缩预览不可用，已插入原图');
                else if (items.length) toast.success(`已插入 ${items.length} 张图片`);
            } catch {
                if (task.current()) toast.error('图片插入失败，请重试');
            } finally {
                task.signal.removeEventListener('abort', closeLoading);
                closeLoading(); task.finish();
            }
        })();
        return true;
    }, COMMAND_PRIORITY_CRITICAL), [editor, begin]);
    return null;
}
