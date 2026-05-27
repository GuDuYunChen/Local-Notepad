import { DecoratorNode } from 'lexical';
import React from 'react';

export class ImageNode extends DecoratorNode {
  __src;
  __alt;
  __width;
  __height;
  __caption;
  __originalSrc;

  static getType() {
    return 'image';
  }

  static clone(node) {
    return new ImageNode(
      node.__src,
      node.__alt,
      node.__width,
      node.__height,
      node.__originalSrc,
      node.__key,
    );
  }

  static importJSON(serializedNode) {
    const { src, alt, width, height, originalSrc, caption } = serializedNode;
    return new ImageNode(src, alt, width, height, originalSrc, caption);
  }

  exportJSON() {
    return {
      alt: this.__alt,
      height: this.__height,
      src: this.__src,
      originalSrc: this.__originalSrc,
      type: 'image',
      version: 1,
      width: this.__width,
      caption: this.__caption,
    };
  }

  constructor(src, alt, width, height, originalSrc, caption, key) {
    super(key);
    this.__src = src;
    this.__alt = alt;
    this.__width = width;
    this.__height = height;
    this.__originalSrc = originalSrc;
    this.__caption = caption || alt || '';
  }

  createDOM(config) {
    const span = document.createElement('span');
    const theme = config.theme;
    const className = theme.image;
    if (className !== undefined) {
      span.className = className;
    }
    return span;
  }

  updateDOM() {
    return false;
  }

  decorate() {
    return (
      <ImageComponent
        src={this.__src}
        alt={this.__alt}
        width={this.__width}
        height={this.__height}
        originalSrc={this.__originalSrc}
        caption={this.__caption}
      />
    );
  }
}

function isValidImageUrl(url) {
    if (!url) return false;
    if (url.startsWith('data:')) return true;
    if (url.startsWith('blob:')) return true;
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch {
        return false;
    }
}

function ImageComponent({ src, alt, width, height, originalSrc, caption }) {
  const safeSrc = isValidImageUrl(src) ? src : '';
  const safeOriginalSrc = isValidImageUrl(originalSrc) ? originalSrc : '';

  const handleDownload = (e) => {
    e.preventDefault();
    const downloadSrc = safeOriginalSrc || safeSrc;
    if (!downloadSrc) return;
    const a = document.createElement('a');
    a.href = downloadSrc;
    a.download = alt || 'image';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <span className="editor-image-wrapper" style={{ display: 'inline-block', position: 'relative' }}>
      {safeSrc ? (
        <img
          src={safeSrc}
          alt={alt}
          loading="lazy"
          title={alt || caption}
          style={{ maxWidth: '100%', height: 'auto', display: 'block' }}
        />
      ) : (
        <div className="image-placeholder" style={{ padding: 20, background: '#f5f5f5', borderRadius: 4, textAlign: 'center', color: '#999' }}>
          无效的图片链接
        </div>
      )}
      {safeSrc && (
        <button
          onClick={handleDownload}
          className="image-download-btn"
          style={{
            position: 'absolute',
            top: 5,
            right: 5,
            background: 'rgba(0,0,0,0.5)',
            color: 'white',
            border: 'none',
            padding: '2px 5px',
            cursor: 'pointer',
            fontSize: '10px',
            borderRadius: '3px',
          }}
          title="下载原图"
          aria-label="下载原图"
        >
          ⬇
        </button>
      )}
      <div className="editor-image-caption" style={{ fontSize: 12, color: '#666', marginTop: 4, textAlign: 'center' }}>{caption}</div>
    </span>
  );
}

export function $createImageNode({ src, alt, width, height, originalSrc, caption }) {
  return new ImageNode(src, alt, width, height, originalSrc, caption);
}

export function $isImageNode(node) {
  return node instanceof ImageNode;
}
