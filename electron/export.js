import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, BorderStyle, WidthType, ImageRun } from 'docx'
import fs from 'fs'
import path from 'path'

// 辅助：获取文件内容（从 Go 后端）
async function fetchFileContent(id) {
    const base = process.env.API_BASE || 'http://127.0.0.1:27121'
    const res = await fetch(`${base}/api/files/${id}`)
    if (!res.ok) throw new Error(`Fetch failed: ${res.statusText}`)
    const body = await res.json()
    if (body.code !== 0) throw new Error(body.message)
    return body.data
}

// 辅助：解析 Lexical State
function parseLexicalState(content) {
    try {
        const state = JSON.parse(content)
        return state.root ? state.root.children : []
    } catch (e) {
        // Fallback: treat as plain text
        return [{ type: 'paragraph', children: [{ type: 'text', text: content }] }]
    }
}

// 转换器：Lexical Node -> Docx Object
async function convertNode(node) {
    if (!node.type) return null

    switch (node.type) {
        case 'heading':
            const level = node.tag === 'h1' ? HeadingLevel.HEADING_1 :
                          node.tag === 'h2' ? HeadingLevel.HEADING_2 :
                          node.tag === 'h3' ? HeadingLevel.HEADING_3 :
                          HeadingLevel.HEADING_4
            return new Paragraph({
                heading: level,
                children: await convertChildren(node.children)
            })
            
        case 'paragraph':
            return new Paragraph({
                children: await convertChildren(node.children)
            })
            
        case 'quote':
            return new Paragraph({
                style: 'Quote', // 需要在 Document 样式中定义，或者直接设置缩进/斜体
                indent: { left: 720 }, // 0.5 inch
                children: await convertChildren(node.children)
            })
            
        case 'list': // unordered-list or ordered-list
             // Lexical lists are nested.
             // But here 'list' usually contains 'listitem'
             // We need to handle list items individually.
             // Actually Lexical 0.10+ structure: list -> listitem
             return await convertList(node)

        case 'table':
            return await convertTable(node)
            
        case 'image':
        case 'image-grid': // Custom node?
            // Handle image logic
            // node.src might be base64 or url
            return await convertImage(node)

        default:
            // Fallback for unknown nodes
            if (node.children) {
                 return new Paragraph({ children: await convertChildren(node.children) })
            }
            return null
    }
}

async function convertChildren(children) {
    if (!children) return []
    const runs = []
    for (const child of children) {
        if (child.type === 'text') {
            runs.push(new TextRun({
                text: child.text,
                bold: (child.format & 1) !== 0,
                italics: (child.format & 2) !== 0,
                strike: (child.format & 4) !== 0,
                underline: (child.format & 8) !== 0 ? {} : undefined,
                code: (child.format & 16) !== 0,
            }))
        } else if (child.type === 'linebreak') {
             // Handled by new TextRun({ break: 1 }) or just ignored if separate paragraph?
             // Usually TextRun can contain break.
             runs.push(new TextRun({ text: '\n' })) // or break: 1
        } else if (child.type === 'link') {
             // Link handling
             const linkRuns = await convertChildren(child.children)
             // docx lib handles ExternalHyperlink
             // For simplicity, just add text runs with color blue
             linkRuns.forEach(r => {
                 // r is TextRun. We can't modify it easily if it's already created?
                 // TextRun is immutable-ish in construction?
                 // Let's just append them. Ideally we wrap in ExternalHyperlink.
                 runs.push(r)
             })
        }
    }
    return runs
}

async function convertList(node) {
    // node.listType: 'bullet' | 'number'
    // node.children: [ { type: 'listitem', children: [...] } ]
    // We return an array of Paragraphs
    const paras = []
    const isNum = node.listType === 'number'
    
    for (const item of node.children) {
        if (item.type === 'listitem') {
            const children = await convertChildren(item.children)
            paras.push(new Paragraph({
                children: children,
                bullet: {
                    level: 0 // nested lists handling needed for robust support
                }
            }))
        }
    }
    return paras // Wait, convertNode returns ONE object usually.
    // If we return array, the caller needs to handle it.
}

async function convertTable(node) {
    // node.children (rows) -> row.children (cells)
    const rows = []
    for (const rowNode of node.children) {
        const cells = []
        for (const cellNode of rowNode.children) {
            // cellNode.children (content inside cell)
            // docx TableCell expects children as Paragraphs/Tables
            // We need to convert cellNode.children recursively
            // But convertNode returns Paragraphs.
            
            const cellContent = []
            for (const n of cellNode.children) {
                const converted = await convertNode(n)
                if (converted) {
                     if (Array.isArray(converted)) cellContent.push(...converted)
                     else cellContent.push(converted)
                }
            }
            if (cellContent.length === 0) {
                cellContent.push(new Paragraph({}))
            }

            cells.push(new TableCell({
                children: cellContent,
                width: { size: 100, type: WidthType.PERCENTAGE }, // Auto width
                borders: {
                    top: { style: BorderStyle.SINGLE, size: 1 },
                    bottom: { style: BorderStyle.SINGLE, size: 1 },
                    left: { style: BorderStyle.SINGLE, size: 1 },
                    right: { style: BorderStyle.SINGLE, size: 1 },
                }
            }))
        }
        rows.push(new TableRow({ children: cells }))
    }
    
    return new Table({
        rows: rows,
        width: { size: 100, type: WidthType.PERCENTAGE }
    })
}

async function convertImage(node) {
    // node.src
    try {
        let buffer
        if (node.src.startsWith('data:')) {
            const base64 = node.src.split(',')[1]
            buffer = Buffer.from(base64, 'base64')
        } else if (node.src.startsWith('http')) {
            // Fetch
            const res = await fetch(node.src)
            const arr = await res.arrayBuffer()
            buffer = Buffer.from(arr)
        }
        
        if (buffer) {
             return new Paragraph({
                 children: [
                     new ImageRun({
                         data: buffer,
                         transformation: { width: 400, height: 300 } // Fixed size for now, better to read metadata
                     })
                 ]
             })
        }
    } catch (e) {
        console.error("Image convert error", e)
    }
    return new Paragraph({ text: "[图片加载失败]" })
}

// 核心导出函数
export async function exportToDocx(files, targetDir) {
    // files: [{ id, content, title, is_folder, ... }]
    // We might need to fetch content if not provided full
    // But `fetchFileContent` does that.
    
    // Recursive export
    // But here we receive a flat list or IDs?
    // The previous implementation passed IDs.
    // Let's assume we receive IDs and fetch recursively?
    // Or we receive the full tree structure?
    // The previous Go implementation did recursive fetching.
    
    // To simplify, let's implement a recursive function that fetches from Go.
    
    // But wait, files is IDs?
    // Let's accept IDs.
}

export async function processExport(ids, targetDir, format = 'docx') {
    const errors = []
    
    async function processItem(id, currentDir) {
        try {
            const file = await fetchFileContent(id)
            const safeTitle = file.title.replace(/[\\/:*?"<>|]/g, '_')
            
            if (file.is_folder) {
                const newDir = path.join(currentDir, safeTitle)
                if (!fs.existsSync(newDir)) fs.mkdirSync(newDir)
                
                const base = process.env.API_BASE || 'http://127.0.0.1:27121'
                const res = await fetch(`${base}/api/files?size=10000`)
                const allFiles = (await res.json()).data
                
                const children = allFiles.filter(f => f.parent_id === id)
                for (const child of children) {
                    await processItem(child.id, newDir, format)
                }
                
            } else {
                if (format === 'markdown' || format === 'md') {
                    const mdContent = convertToMarkdown(file.content)
                    fs.writeFileSync(path.join(currentDir, `${safeTitle}.md`), mdContent)
                } else {
                    const docChildren = []
                    const lexicalNodes = parseLexicalState(file.content)
                    
                    for (const node of lexicalNodes) {
                        const converted = await convertNode(node)
                        if (converted) {
                            if (Array.isArray(converted)) docChildren.push(...converted)
                            else docChildren.push(converted)
                        }
                    }
                    
                    const doc = new Document({
                        sections: [{
                            properties: {},
                            children: docChildren
                        }]
                    })
                    
                    const buffer = await Packer.toBuffer(doc)
                    fs.writeFileSync(path.join(currentDir, `${safeTitle}.docx`), buffer)
                }
            }
        } catch (e) {
            console.error(`Export ${id} failed`, e)
            errors.push(id)
        }
    }

    for (const id of ids) {
        await processItem(id, targetDir, format)
    }
    
    return errors
}

function convertToMarkdown(lexicalJSON) {
    try {
        const state = JSON.parse(lexicalJSON)
        const root = state.root || { children: [] }
        return processLexicalRoot(root)
    } catch (e) {
        return lexicalJSON
    }
}

function processLexicalRoot(root) {
    const lines = []
    for (const node of root.children || []) {
        processNodeToMarkdown(node, lines, 0)
    }
    return lines.join('\n')
}

function processNodeToMarkdown(node, lines, depth) {
    if (!node || !node.type) return
    
    switch (node.type) {
        case 'paragraph':
            const text = processInlineNodes(node.children || [])
            if (text) {
                lines.push(text)
                lines.push('')
            }
            break
            
        case 'heading':
            const level = node.level || 1
            const headingText = processInlineNodes(node.children || [])
            lines.push(`${'#'.repeat(level)} ${headingText}`)
            lines.push('')
            break
            
        case 'list':
            const listType = node.listType === 'number' ? 'number' : 'bullet'
            processListItems(node.children || [], lines, listType, 0)
            break
            
        case 'quote':
            const quoteText = processInlineNodes(node.children || [])
            lines.push(`> ${quoteText}`)
            lines.push('')
            break
            
        case 'code':
            const codeText = processInlineNodes(node.children || [])
            lines.push('```')
            lines.push(codeText)
            lines.push('```')
            lines.push('')
            break
            
        case 'code-block':
            const lang = node.language || ''
            const blockText = processInlineNodes(node.children || [])
            lines.push(`\`\`\`${lang}`)
            lines.push(blockText)
            lines.push('```')
            lines.push('')
            break
            
        case 'table':
            processTableToMarkdown(node, lines)
            break
            
        default:
            if (node.children) {
                for (const child of node.children) {
                    processNodeToMarkdown(child, lines, depth + 1)
                }
            }
    }
}

function processInlineNodes(children) {
    if (!children || children.length === 0) return ''
    
    let result = ''
    for (const child of children) {
        if (child.type === 'text') {
            let text = child.text || ''
            const format = child.format || 0
            
            if (format & 16) text = `\`${text}\``
            else {
                if (format & 8) text = `~~${text}~~`
                if (format & 2) text = `*${text}*`
                if (format & 1) text = `**${text}**`
            }
            result += text
        } else if (child.type === 'linebreak') {
            result += '\n'
        } else if (child.type === 'link') {
            const linkText = processInlineNodes(child.children || [])
            result += `[${linkText}](${child.url || ''})`
        }
    }
    return result
}

function processListItems(items, lines, listType, indent) {
    let counter = 1
    const prefix = '  '.repeat(indent)
    
    for (const item of items) {
        if (item.type === 'listitem') {
            const text = processInlineNodes(item.children || [])
            const bullet = listType === 'number' ? `${counter}.` : '-'
            lines.push(`${prefix}${bullet} ${text}`)
            counter++
            
            for (const child of item.children || []) {
                if (child.type === 'list') {
                    const nestedType = child.listType === 'number' ? 'number' : 'bullet'
                    processListItems(child.children || [], lines, nestedType, indent + 1)
                }
            }
        }
    }
}

function processTableToMarkdown(node, lines) {
    const rows = node.children || []
    if (rows.length === 0) return
    
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        const cells = row.children || []
        const cellTexts = cells.map(cell => processInlineNodes(cell.children || []))
        lines.push(`| ${cellTexts.join(' | ')} |`)
        
        if (i === 0) {
            lines.push(`| ${cells.map(() => '---').join(' | ')} |`)
        }
    }
    lines.push('')
}
