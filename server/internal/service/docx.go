package service

import (
	"fmt"
	"strings"

	"github.com/gingfrederik/docx"
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/text"
)

// ConvertToDocx converts markdown content to a docx file at outputPath
func ConvertToDocx(content string, outputPath string) error {
	f := docx.NewFile()

	md := goldmark.New()
	source := []byte(content)
	reader := text.NewReader(source)
	doc := md.Parser().Parse(reader)

	err := ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}

		switch n.Kind() {
		case ast.KindHeading:
			h := n.(*ast.Heading)
			text := getNodeText(n, source)
			p := f.AddParagraph()
			// docx library doesn't seem to support semantic headings easily in the basic version,
			// but we can make it bold and larger if the lib supports it, or just add text.
			// gingfrederik/docx is very basic.
			// Let's check if we can set size/bold.
			// The lib has p.AddText("foo").Size(20).Color("red")

			size := 24 - (h.Level * 2) // Simple scaling
			if size < 12 {
				size = 12
			}
			p.AddText(text).Size(size)

			return ast.WalkSkipChildren, nil

		case ast.KindParagraph:
			// Paragraph children are text, strong, em, etc.
			// We need to handle inline elements.
			// Since walk visits children, we can create a paragraph and let children append to it?
			// The walker is depth-first.
			// If we create a paragraph here, how do we pass it to children?
			// The walk function doesn't pass context.

			// Strategy: For KindParagraph, we collect all text from children manually.
			text := getNodeText(n, source)
			p := f.AddParagraph()
			p.AddText(text)
			return ast.WalkSkipChildren, nil

		case ast.KindList:
			// We can handle lists by iterating children (ListItem)
			return ast.WalkContinue, nil

		case ast.KindListItem:
			// Get text content
			text := getNodeText(n, source)
			p := f.AddParagraph()
			p.AddText("• " + text) // Simulate bullet
			return ast.WalkSkipChildren, nil

		case ast.KindFencedCodeBlock, ast.KindCodeBlock:
			text := getNodeText(n, source)
			p := f.AddParagraph()
			p.AddText(text)
			return ast.WalkSkipChildren, nil
		}

		return ast.WalkContinue, nil
	})

	if err != nil {
		return fmt.Errorf("walking AST failed: %w", err)
	}

	if err := f.Save(outputPath); err != nil {
		return fmt.Errorf("saving docx failed: %w", err)
	}

	return nil
}

// Helper to extract text from a node and its children
func getNodeText(n ast.Node, source []byte) string {
	var sb strings.Builder
	ast.Walk(n, func(child ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		if textNode, ok := child.(*ast.Text); ok {
			sb.Write(textNode.Segment.Value(source))
		}
		return ast.WalkContinue, nil
	})
	return sb.String()
}
