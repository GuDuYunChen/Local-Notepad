package logic

import (
	"fmt"
	"strings"

	"github.com/gingfrederik/docx"
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/text"
)

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
			size := 24 - (h.Level * 2)
			if size < 12 {
				size = 12
			}
			p.AddText(text).Size(size)
			return ast.WalkSkipChildren, nil

		case ast.KindParagraph:
			text := getNodeText(n, source)
			p := f.AddParagraph()
			p.AddText(text)
			return ast.WalkSkipChildren, nil

		case ast.KindList:
			return ast.WalkContinue, nil

		case ast.KindListItem:
			text := getNodeText(n, source)
			p := f.AddParagraph()
			p.AddText("• " + text)
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
