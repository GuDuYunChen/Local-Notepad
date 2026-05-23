import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getRoot, $getSelection, $isRangeSelection, $createRangeSelection } from 'lexical';
import { mergeRegister } from '@lexical/utils';

function $findAllTextNodes(text) {
  const root = $getRoot();
  const results = [];
  const lowerText = text.toLowerCase();

  function traverse(node) {
    if (node.getType() === 'text') {
      const nodeText = node.getTextContent();
      const lowerNodeText = nodeText.toLowerCase();
      let startIndex = 0;
      while (true) {
        const idx = lowerNodeText.indexOf(lowerText, startIndex);
        if (idx === -1) break;
        results.push({ node, offset: idx, length: text.length });
        startIndex = idx + 1;
      }
    }
    const children = node.getChildren ? node.getChildren() : [];
    children.forEach(traverse);
  }

  root.getChildren().forEach(traverse);
  return results;
}

export default function SearchPlugin() {
  const [editor] = useLexicalComposerContext();
  const [isOpen, setIsOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [matchCount, setMatchCount] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !searchText) {
      setMatchCount(0);
      setCurrentIndex(-1);
      return;
    }

    editor.update(() => {
      const results = $findAllTextNodes(searchText);
      setMatchCount(results.length);
      if (results.length > 0) {
        setCurrentIndex(0);
        const { node, offset, length } = results[0];
        node.select(offset, offset + length);
      }
    });
  }, [isOpen, searchText, editor]);

  const goToMatch = useCallback((index) => {
    editor.update(() => {
      const results = $findAllTextNodes(searchText);
      if (results.length === 0) return;
      const idx = ((index % results.length) + results.length) % results.length;
      setCurrentIndex(idx);
      const { node, offset, length } = results[idx];
      node.select(offset, offset + length);
    });
  }, [editor, searchText]);

  const handleFindNext = useCallback(() => {
    goToMatch(currentIndex + 1);
  }, [goToMatch, currentIndex]);

  const handleFindPrev = useCallback(() => {
    goToMatch(currentIndex - 1);
  }, [goToMatch, currentIndex]);

  const handleReplace = useCallback(() => {
    if (currentIndex < 0) return;
    editor.update(() => {
      const results = $findAllTextNodes(searchText);
      if (results.length === 0 || currentIndex >= results.length) return;
      const { node, offset, length } = results[currentIndex];
      const textContent = node.getTextContent();
      const newText = textContent.slice(0, offset) + replaceText + textContent.slice(offset + length);
      node.setTextContent(newText);
      const newResults = $findAllTextNodes(searchText);
      setMatchCount(newResults.length);
      if (newResults.length > 0) {
        goToMatch(currentIndex % newResults.length);
      }
    });
  }, [editor, searchText, replaceText, currentIndex, goToMatch]);

  const handleReplaceAll = useCallback(() => {
    if (!searchText) return;
    editor.update(() => {
      let count = 0;
      while (true) {
        const results = $findAllTextNodes(searchText);
        if (results.length === 0) break;
        const { node, offset, length } = results[0];
        const textContent = node.getTextContent();
        const newText = textContent.slice(0, offset) + replaceText + textContent.slice(offset + length);
        node.setTextContent(newText);
        count++;
        if (count > 10000) break;
      }
      setMatchCount(0);
      setCurrentIndex(-1);
    });
  }, [editor, searchText, replaceText]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setIsOpen(prev => !prev);
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        setIsOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (!isOpen) return null;

  return (
    <div className="search-panel">
      <div className="search-row">
        <input
          ref={inputRef}
          className="search-input"
          placeholder="搜索…"
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
        />
        <div className="search-count">
          {matchCount > 0 ? `${currentIndex + 1}/${matchCount}` : '0/0'}
        </div>
        <button className="search-btn" onClick={handleFindPrev} disabled={matchCount === 0}>↑</button>
        <button className="search-btn" onClick={handleFindNext} disabled={matchCount === 0}>↓</button>
        <button className="search-btn close-btn" onClick={() => setIsOpen(false)}>×</button>
      </div>
      <div className="search-row">
        <input
          className="search-input"
          placeholder="替换…"
          value={replaceText}
          onChange={e => setReplaceText(e.target.value)}
        />
        <button className="search-btn" onClick={handleReplace} disabled={matchCount === 0 || currentIndex < 0}>替换</button>
        <button className="search-btn" onClick={handleReplaceAll} disabled={matchCount === 0}>全部替换</button>
      </div>
    </div>
  );
}
