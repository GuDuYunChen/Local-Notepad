package service

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

// LexicalNode represents a node in Lexical editor state
type LexicalNode struct {
	Type     string          `json:"type"`
	Text     string          `json:"text,omitempty"`
	Children []LexicalNode   `json:"children,omitempty"`
	Format   int             `json:"format,omitempty"`
	Tag      string          `json:"tag,omitempty"`
	Level    int             `json:"level,omitempty"`
}

// ExportToMarkdown converts Lexical JSON to Markdown and saves to file
func ExportToMarkdown(lexicalJSON string, outputPath string) error {
	var state map[string]interface{}
	if err := json.Unmarshal([]byte(lexicalJSON), &state); err != nil {
		return fmt.Errorf("解析编辑器状态失败: %w", err)
	}

	root, ok := state["root"].(map[string]interface{})
	if !ok {
		return fmt.Errorf("无效的编辑器状态: 缺少 root")
	}

	children, ok := root["children"].([]interface{})
	if !ok {
		return fmt.Errorf("无效的编辑器状态: 缺少 children")
	}

	var md strings.Builder
	for _, child := range children {
		processNode(child, &md, 0)
	}

	if err := os.WriteFile(outputPath, []byte(md.String()), 0644); err != nil {
		return fmt.Errorf("写入 Markdown 文件失败: %w", err)
	}

	return nil
}

func processNode(node interface{}, md *strings.Builder, depth int) {
	n, ok := node.(map[string]interface{})
	if !ok {
		return
	}

	nodeType, _ := n["type"].(string)
	
	switch nodeType {
	case "paragraph":
		if children, ok := n["children"].([]interface{}); ok {
			for _, child := range children {
				processInlineNode(child, md)
			}
		}
		md.WriteString("\n\n")
		
	case "heading":
		level, _ := n["level"].(float64)
		for i := 0; i < int(level); i++ {
			md.WriteString("#")
		}
		md.WriteString(" ")
		if children, ok := n["children"].([]interface{}); ok {
			for _, child := range children {
				processInlineNode(child, md)
			}
		}
		md.WriteString("\n\n")
		
	case "list":
		listType, _ := n["listType"].(string)
		if children, ok := n["children"].([]interface{}); ok {
			for _, child := range children {
				processListNode(child, md, listType, 1)
			}
		}
		
	case "quote":
		md.WriteString("> ")
		if children, ok := n["children"].([]interface{}); ok {
			for _, child := range children {
				processInlineNode(child, md)
			}
		}
		md.WriteString("\n\n")
		
	case "code":
		if children, ok := n["children"].([]interface{}); ok {
			for _, child := range children {
				if cn, ok := child.(map[string]interface{}); ok {
					if text, ok := cn["text"].(string); ok {
						md.WriteString(text)
					}
				}
			}
		}
		md.WriteString("\n\n")
		
	case "code-block":
		language, _ := n["language"].(string)
		md.WriteString("```")
		md.WriteString(language)
		md.WriteString("\n")
		if children, ok := n["children"].([]interface{}); ok {
			for _, child := range children {
				if cn, ok := child.(map[string]interface{}); ok {
					if text, ok := cn["text"].(string); ok {
						md.WriteString(text)
					}
				}
			}
		}
		md.WriteString("\n```\n\n")
		
	case "table":
		if children, ok := n["children"].([]interface{}); ok {
			for i, child := range children {
				processTableRow(child, md, i == 0)
			}
		}
		md.WriteString("\n")
		
	default:
		// Try to process as generic node
		if children, ok := n["children"].([]interface{}); ok {
			for _, child := range children {
				processNode(child, md, depth+1)
			}
		}
	}
}

func processInlineNode(node interface{}, md *strings.Builder) {
	n, ok := node.(map[string]interface{})
	if !ok {
		return
	}

	format, _ := n["format"].(float64)
	text, hasText := n["text"].(string)
	
	if !hasText {
		if children, ok := n["children"].([]interface{}); ok {
			for _, child := range children {
				processInlineNode(child, md)
			}
		}
		return
	}
	
	// Apply formatting
	isBold := int(format)&1 != 0
	isItalic := int(format)&2 != 0
	isUnderline := int(format)&4 != 0
	isStrikethrough := int(format)&8 != 0
	
	if isBold {
		md.WriteString("**")
	}
	if isItalic {
		md.WriteString("*")
	}
	if isStrikethrough {
		md.WriteString("~~")
	}
	
	md.WriteString(text)
	
	if isStrikethrough {
		md.WriteString("~~")
	}
	if isItalic {
		md.WriteString("*")
	}
	if isBold {
		md.WriteString("**")
	}
	if isUnderline {
		// Markdown doesn't support underline natively, use HTML
		md.WriteString("")
	}
}

func processListNode(node interface{}, md *strings.Builder, listType string, level int) {
	n, ok := node.(map[string]interface{})
	if !ok {
		return
	}

	nodeType, _ := n["type"].(string)
	
	if nodeType == "listitem" {
		prefix := strings.Repeat("  ", level-1)
		if listType == "bullet" {
			md.WriteString(prefix + "- ")
		} else {
			md.WriteString(prefix + "1. ")
		}
		
		if children, ok := n["children"].([]interface{}); ok {
			for _, child := range children {
				processInlineNode(child, md)
			}
		}
		md.WriteString("\n")
		
		// Check for nested lists
		if children, ok := n["children"].([]interface{}); ok {
			for _, child := range children {
				if cn, ok := child.(map[string]interface{}); ok {
					if cnType, _ := cn["type"].(string); cnType == "list" {
						nestedType, _ := cn["listType"].(string)
						if nestedChildren, ok := cn["children"].([]interface{}); ok {
							for _, nc := range nestedChildren {
								processListNode(nc, md, nestedType, level+1)
							}
						}
					}
				}
			}
		}
	}
}

func processTableRow(node interface{}, md *strings.Builder, isHeader bool) {
	n, ok := node.(map[string]interface{})
	if !ok {
		return
	}

	nodeType, _ := n["type"].(string)
	
	if nodeType == "tablerow" {
		if children, ok := n["children"].([]interface{}); ok {
			for _, child := range children {
				md.WriteString("| ")
				if cn, ok := child.(map[string]interface{}); ok {
					if cnChildren, ok := cn["children"].([]interface{}); ok {
						for _, c := range cnChildren {
							processInlineNode(c, md)
						}
					}
				}
				md.WriteString(" ")
			}
		}
		md.WriteString("|\n")
		
		if isHeader {
			// Add separator row
			if children, ok := n["children"].([]interface{}); ok {
				for range children {
					md.WriteString("| --- ")
				}
			}
			md.WriteString("|\n")
		}
	}
}
