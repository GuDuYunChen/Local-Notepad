import React, { Children, Fragment, forwardRef, isValidElement, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, Select, ConfigProvider } from 'antd'
const quietWave = { disabled: true }
const controlTheme = { components: {
  Input: { paddingBlock: 8, paddingInline: 10, paddingBlockSM: 5, paddingInlineSM: 10 },
  Select: { optionHeight: 32, controlHeight: 40, controlHeightSM: 28 },
  Button: { primaryShadow: 'none', defaultShadow: 'none', dangerShadow: 'none' }
} }

const nativeTypes = new Set(['checkbox', 'radio', 'file', 'range', 'color', 'hidden', 'image', 'button', 'submit', 'reset'])
const writeRef = (ref, value) => { if (typeof ref === 'function') ref(value); else if (ref) ref.current = value }
const inputNode = value => value?.input || value?.resizableTextArea?.textArea || value?.nativeElement || value
const nativeRef = ref => value => writeRef(ref, inputNode(value))
const hasClass = (value, token) => String(value || '').split(/\s+/).includes(token)
const cleanClass = value => String(value || '').split(/\s+/).filter(token => token && true).join(' ')
const controlSize = (size, density) => ['small', 'middle', 'large'].includes(size) ? size : density === 'compact' ? 'small' : 'middle'
const errorStatus = props => props.status || (props['aria-invalid'] === true || props['aria-invalid'] === 'true' ? 'error' : undefined)

// A custom Select's trigger is not disabled by HTML fieldset inheritance. Preserve
// that browser rule explicitly, including the first-legend exception and nesting.
export function fieldsetDisabled(node) {
  if (!node) return false
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    if (parent.tagName !== 'FIELDSET' || !parent.disabled) continue
    const legend = [...parent.children].find(child => child.tagName === 'LEGEND')
    if (!legend || !legend.contains(node)) return true
  }
  return false
}
function useInheritedDisabled(node) {
  const [disabled, setDisabled] = useState(false)
  useLayoutEffect(() => { const next = fieldsetDisabled(node); setDisabled(previous => previous === next ? previous : next) })
  useEffect(() => {
    if (!node || typeof MutationObserver === 'undefined') return
    const observer = new MutationObserver(() => setDisabled(fieldsetDisabled(node)))
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      if (parent.tagName === 'FIELDSET') observer.observe(parent, { attributes: true, attributeFilter: ['disabled'], childList: true })
    }
    return () => observer.disconnect()
  }, [node])
  return disabled
}

export const UiButton = forwardRef(function UiButton({ type, htmlType, variant, danger, size, density, className = '', onClick, onMouseDown, children, ...props }, ref) {
  const structural = /(?:row|item|nav|menu|tab|swatch|handle|close|toggle|icon|chip|pill)/i.test(className) || ['tab', 'menuitem', 'option', 'treeitem'].includes(props.role)
  const kind = variant || (hasClass(className, 'primary') || type === 'primary' ? 'primary' : structural ? 'text' : 'secondary')
  const nativeType = htmlType || (['button', 'submit', 'reset'].includes(type) ? type : type === undefined ? 'submit' : 'button')
  const buttonType = kind === 'primary' ? 'primary' : ['text', 'link', 'dashed'].includes(kind) ? kind : 'default'
  const guard = handler => event => { if (props.disabled || fieldsetDisabled(event.currentTarget)) { event.preventDefault(); event.stopPropagation(); return } handler?.(event) }
  return <ConfigProvider wave={quietWave} theme={controlTheme}><Button {...props} ref={nativeRef(ref)} htmlType={nativeType} type={buttonType} danger={danger ?? hasClass(className, 'danger')} autoInsertSpace={false}
    size={controlSize(size, density)} data-ui-control="button" data-ui-layout={structural ? 'content' : 'action'}
    className={['app-ui-button', cleanClass(className)].filter(Boolean).join(' ')} onClick={guard(onClick)} onMouseDown={guard(onMouseDown)}>{children}</Button></ConfigProvider>
})

export const UiInput = forwardRef(function UiInput({ className = '', size, density, type = 'text', ...props }, ref) {
  if (nativeTypes.has(type)) return <input {...props} ref={ref} type={type} className={className} data-ui-native={type} />
  return <ConfigProvider theme={controlTheme}><Input {...props} ref={nativeRef(ref)} type={type} size={controlSize(size, density)} status={errorStatus(props)}
    data-ui-control="input" className={['app-ui-input', cleanClass(className)].filter(Boolean).join(' ')} /></ConfigProvider>
})
export const UiPassword = forwardRef(function UiPassword({ className = '', size, density, type: _type, ...props }, ref) {
  return <ConfigProvider theme={controlTheme}><Input.Password {...props} ref={nativeRef(ref)} size={controlSize(size, density)} status={errorStatus(props)}
    data-ui-control="password" className={['app-ui-input', cleanClass(className)].filter(Boolean).join(' ')} /></ConfigProvider>
})
export const UiTextarea = forwardRef(function UiTextarea({ className = '', size, density, ...props }, ref) {
  return <ConfigProvider theme={controlTheme}><Input.TextArea {...props} ref={nativeRef(ref)} size={controlSize(size, density)} status={errorStatus(props)}
    data-ui-control="textarea" className={['app-ui-input', cleanClass(className)].filter(Boolean).join(' ')} /></ConfigProvider>
})

function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  return isValidElement(node) ? textOf(node.props.children) : ''
}
export function selectOptions(children) {
  const result = []
  Children.forEach(children, child => {
    if (!isValidElement(child)) return
    if (child.type === Fragment) { result.push(...selectOptions(child.props.children)); return }
    if (child.type === 'optgroup') { result.push({ label: child.props.label, options: selectOptions(child.props.children).map(option => ({ ...option, disabled: child.props.disabled || option.disabled })) }); return }
    if (child.type !== 'option') throw new TypeError('UiSelect accepts option and optgroup children only')
    const label = child.props.label ?? child.props.children
    result.push({ value: String(child.props.value ?? textOf(child.props.children)), label, title: child.props.title ?? textOf(label), disabled: Boolean(child.props.disabled), selected: Boolean(child.props.selected) })
  })
  return result
}
const normalOptions = options => options.map(option => option.options ? { ...option, options: normalOptions(option.options) } : { ...option, value: String(option.value ?? textOf(option.label)), title: option.title ?? textOf(option.label) })
const flatOptions = options => options.flatMap(option => option.options ? flatOptions(option.options) : [option])
const normalValue = value => Array.isArray(value) ? value.map(String) : value == null ? '' : String(value)

export const UiSelect = forwardRef(function UiSelect({ className = '', style, size, density, onChange, onInput, options, children, multiple = false,
  value, defaultValue, disabled = false, name, form, required = false, id, onKeyDown, onInputKeyDown, onOpenChange, onDropdownVisibleChange,
  open: requestedOpen, showSearch, getPopupContainer, ...props }, forwardedRef) {
  const resolved = useMemo(() => normalOptions(options ?? selectOptions(children)), [options, children])
  const flat = useMemo(() => flatOptions(resolved), [resolved])
  const initial = () => normalValue(defaultValue ?? (multiple ? flat.filter(option => option.selected).map(option => option.value) : flat.find(option => option.selected)?.value ?? flat[0]?.value ?? ''))
  const controlled = value !== undefined
  const [local, setLocal] = useState(initial)
  const selected = controlled ? normalValue(value) : local
  const [node, setNode] = useState(null), api = useRef(null)
  const inherited = useInheritedDisabled(node), blocked = disabled || inherited
  const [expanded, setExpanded] = useState(false)
  const latest = useRef(null); latest.current = { selected, controlled }
  useImperativeHandle(forwardedRef, () => ({ focus: options => api.current?.focus(options), blur: () => api.current?.blur(), nativeElement: node,
    get value() { return latest.current.selected }, get disabled() { return disabled || fieldsetDisabled(node) } }), [node, disabled])
  useEffect(() => { if (blocked) setExpanded(false) }, [blocked])
  useEffect(() => {
    if (!controlled && !multiple && !flat.some(option => option.value === local)) setLocal(flat[0]?.value ?? '')
  }, [controlled, multiple, flat, local])
  useEffect(() => {
    const owner = form ? document.getElementById(form) : node?.closest('form')
    if (!owner || controlled) return
    const reset = () => { setLocal(initial()); setExpanded(false) }
    owner.addEventListener('reset', reset); return () => owner.removeEventListener('reset', reset)
  }, [node, form, controlled, defaultValue, resolved])
  const change = next => {
    if (disabled || fieldsetDisabled(node)) return
    const result = normalValue(next)
    if (!controlled) setLocal(result)
    const chosen = flat.filter(option => Array.isArray(result) ? result.includes(option.value) : result === option.value)
    const target = { value: Array.isArray(result) ? result[0] ?? '' : result, name: name ?? '', id: id ?? '', selectedIndex: flat.findIndex(option => option.value === result), options: flat, selectedOptions: chosen }
    const nativeEvent = new Event('change', { bubbles: true })
    const event = { type: 'change', target, currentTarget: target, nativeEvent, preventDefault: () => nativeEvent.preventDefault(), stopPropagation: () => nativeEvent.stopPropagation() }
    onInput?.({ ...event, type: 'input' }); onChange?.(event)
  }
  const open = requestedOpen ?? expanded
  const changeOpen = next => { const allowed = next && !disabled && !fieldsetDisabled(node); setExpanded(allowed); onOpenChange?.(allowed); onDropdownVisibleChange?.(allowed) }
  const key = event => {
    onInputKeyDown?.(event); onKeyDown?.(event)
    if (event.key === 'Escape' && open && !event.nativeEvent?.isComposing) { event.stopPropagation(); changeOpen(false) }
  }
  // Native form participation only: no hidden select or test-only interaction path.
  const values = Array.isArray(selected) ? selected : [selected]
  const activate = event => {
    if (blocked || requestedOpen !== undefined) return
    if ((event.type === 'mousedown' || event.type === 'click') && event.target.closest?.('.ant-select-selector')) changeOpen(true)
    if (event.type === 'keydown' && (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') && !open) changeOpen(true)
  }
  return <ConfigProvider theme={controlTheme}><span ref={setNode} data-ui-control="select" data-ui-value={JSON.stringify(selected)} className={['app-ui-select-host', cleanClass(className)].filter(Boolean).join(' ')} style={style}
    onMouseDown={activate} onClick={activate} onKeyDown={activate}>
    <Select {...props} virtual={false} optionRender={option => <span data-ui-option-value={String(option.value)}>{option.label}</span>} ref={api} id={id} aria-required={required || undefined} value={selected} options={resolved} disabled={blocked}
      mode={multiple ? 'multiple' : undefined} size={controlSize(size, density)} status={errorStatus(props)} className="app-ui-select"
      showSearch={showSearch ?? flat.length > 12} optionFilterProp="label" open={blocked ? false : open} onOpenChange={changeOpen} onChange={change} onInputKeyDown={key}
      getPopupContainer={getPopupContainer || (trigger => trigger.closest('[role="dialog"], [role="alertdialog"]') || trigger.ownerDocument.body)} />
    {name && values.map((item, index) => <input key={index} type="hidden" data-ui-native="form-value" name={name} form={form} value={item} disabled={blocked} />)}
    {required && <input className="app-ui-validation-field" data-ui-native="form-validation" type="text" aria-hidden="true" tabIndex={-1} form={form}
      value={values.some(item => item !== '') ? 'selected' : ''} readOnly={false} required disabled={blocked} onChange={() => {}}
      onInvalid={event => { event.preventDefault(); api.current?.focus() }} />}
  </span></ConfigProvider>
})
