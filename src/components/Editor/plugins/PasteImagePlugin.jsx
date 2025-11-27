import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { PASTE_COMMAND, COMMAND_PRIORITY_CRITICAL, $insertNodes } from 'lexical';
import { $createImageNode } from '../nodes/ImageNode';
import { compressImage, uploadFile } from '../utils/fileUpload';

export default function PasteImagePlugin() {
    const [editor] = useLexicalComposerContext();

    useEffect(() => {
        return editor.registerCommand(
            PASTE_COMMAND,
            (event) => {
                const files = event.clipboardData?.files;
                // console.log('Paste event:', event);
                // console.log('Clipboard files:', files);

                if (files && files.length > 0) {
                    let hasImage = false;
                    for (let i = 0; i < files.length; i++) {
                        const file = files[i];
                        if (file.type.startsWith('image/')) {
                            hasImage = true;
                            // console.log('Found image file:', file);
                            
                            (async () => {
                                let srcUrl, originalUrl;
                                const uploadSafe = async (f) => {
                                    try { return await uploadFile(f); } catch (e) { console.error('Upload error:', e); return null; }
                                };

                                const type = file.type || '';
                                const skipCompress = type.includes('gif') || type.includes('png');
                                if (!skipCompress && file.size > 2 * 1024 * 1024) {
                                    try {
                                        const compressedFile = await compressImage(file);
                                        const [resCompressed, resOriginal] = await Promise.all([
                                            uploadSafe(compressedFile),
                                            uploadSafe(file)
                                        ]);
                                        if (resCompressed && resOriginal) {
                                            srcUrl = resCompressed.url;
                                            originalUrl = resOriginal.url;
                                        }
                                    } catch (e) {
                                        console.error('Compression failed', e);
                                        const res = await uploadSafe(file);
                                        if (res) srcUrl = originalUrl = res.url;
                                    }
                                } else {
                                    const res = await uploadSafe(file);
                                    if (res) srcUrl = originalUrl = res.url;
                                }

                                if (srcUrl) {
                                    editor.update(() => {
                                        const node = $createImageNode({ src: srcUrl, originalSrc: originalUrl, alt: file.name || 'Pasted Image', width: 500 });
                                        $insertNodes([node]);
                                    });
                                }
                            })();
                        }
                    }
                    if (hasImage) return true;
                }
                return false;
            },
            COMMAND_PRIORITY_CRITICAL
        );
    }, [editor]);

    return null;
}
