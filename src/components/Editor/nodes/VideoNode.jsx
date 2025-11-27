import { DecoratorNode } from 'lexical';
import React from 'react';

export class VideoNode extends DecoratorNode {
  __src;
  __width;
  __height;
  __poster;
  __duration;

  static getType() {
    return 'video';
  }

  static clone(node) {
    return new VideoNode(node.__src, node.__width, node.__height, node.__poster, node.__duration, node.__key);
  }

  static importJSON(serializedNode) {
    const { src, width, height, poster, duration } = serializedNode;
    return new VideoNode(src, width, height, poster, duration);
  }

  exportJSON() {
    return {
      src: this.__src,
      width: this.__width,
      height: this.__height,
      poster: this.__poster,
      duration: this.__duration,
      type: 'video',
      version: 1,
    };
  }

  constructor(src, width, height, poster, duration, key) {
    super(key);
    this.__src = src;
    this.__width = width;
    this.__height = height;
    this.__poster = poster;
    this.__duration = duration;
  }

  createDOM(config) {
    const span = document.createElement('span');
    const theme = config.theme;
    const className = theme.video;
    if (className !== undefined) {
      span.className = className;
    }
    return span;
  }

  updateDOM() {
    return false;
  }

  decorate() {
    return <VideoComponent src={this.__src} width={this.__width} height={this.__height} poster={this.__poster} duration={this.__duration} />;
  }
}

function VideoComponent({ src, width, height, poster, duration }) {
  const formatDuration = (seconds) => {
      if (!seconds) return '';
      const m = Math.floor(seconds / 60);
      const s = Math.floor(seconds % 60);
      return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="editor-video-wrapper" style={{ position: 'relative', display: 'inline-block' }}>
      <video
        src={src}
        controls
        poster={poster}
        style={{ maxWidth: '100%', maxHeight: 400, display: 'block' }}
      />
      {duration && (
          <div style={{
              position: 'absolute',
              bottom: 40, // above controls roughly
              right: 10,
              background: 'rgba(0,0,0,0.7)',
              color: 'white',
              padding: '2px 5px',
              borderRadius: '4px',
              fontSize: '12px',
              pointerEvents: 'none'
          }}>
              {formatDuration(duration)}
          </div>
      )}
    </div>
  );
}

export function $createVideoNode({ src, width, height, poster, duration }) {
  return new VideoNode(src, width, height, poster, duration);
}

export function $isVideoNode(node) {
  return node instanceof VideoNode;
}
