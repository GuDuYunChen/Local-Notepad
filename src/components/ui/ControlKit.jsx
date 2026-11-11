import React, { Children, Fragment, forwardRef, isValidElement, useCallback, useContext, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Button from 'antd/es/button'
import Input from 'antd/es/input'
import theme from 'antd/es/theme'
import Select from 'antd/es/select'
import ConfigProvider from 'antd/es/config-provider'
import { StyleContext } from '@ant-design/cssinjs'
import UiControlDefaultsContext from './UiControlDefaultsContext'
import './control-kit.css'
const quietWave = { disabled: true }
const controlTheme = { token: { motion: false }, components: {
  Select: { optionHeight: 32, zIndexPopup: 1600, controlOutlineWidth: 0 },
  Button: { primaryShadow: 'none', defaultShadow: 'none', dangerShadow: 'none' }
} }
const standaloneControlTheme = { ...controlTheme, cssVar: { key: 'css-var-local-notepad-default-controls' } }
const defaultStyleKeys = new Set(['cache', 'defaultCache', 'hashPriority', 'autoPrefix'])

// Identical standalone defaults can share one CSS-variable sheet. Other theme,
// namespace, CSP or style-cache owners retain Ant Design's unique scope keys.
function useFallbackControlTheme() {
  const config = useContext(ConfigProvider.ConfigContext)
  const style = useContext(StyleContext)
  const styleKeys = Object.keys(style)
  const defaultStyle = style.defaultCache === true && style.hashPriority === 'low' && style.autoPrefix === false &&
    styleKeys.length === defaultStyleKeys.size && styleKeys.every(key => defaultStyleKeys.has(key))
  const defaultConfig = config.theme === undefined && config.csp === undefined &&
    config.getPrefixCls('') === 'ant' && config.iconPrefixCls === 'anticon'
  return defaultConfig && defaultStyle ? standaloneControlTheme : controlTheme
}

const nativeTypes = new Set(['checkbox', 'radio', 'file', 'range', 'color', 'hidden', 'image', 'button', 'submit', 'reset'])
const writeRef = (ref, value) => { if (typeof ref === 'function') ref(value); else if (ref) ref.current = value }
const inputNode = value => value?.input || value?.resizableTextArea?.textArea || value?.nativeElement || value
const nativeRef = ref => value => writeRef(ref, inputNode(value))
const hasClass = (value, token) => String(value || '').split(/\s+/).includes(token)
const cleanClass = value => String(value || '').split(/\s+/).filter(token => token && true).join(' ')
// Legacy presentation utility classes must not restyle Ant Design internals.
const cleanControlClass = value => cleanClass(value)
const controlSize = (size, density, classes) => ['small', 'middle', 'large'].includes(size) ? size : density === 'compact' || hasClass(classes, 'small') ? 'small' : 'middle'
const errorStatus = props => props.status || (props['aria-invalid'] === true || props['aria-invalid'] === 'true' ? 'error' : undefined)

// Prepare the browser's synchronous default action, then observe its final
// cancellation result after all reset listeners have run. A microtask can run
// between listeners of a trusted event, so completion uses a cancellable task.
function useFormReset(nodeRef, owner, prepare) {
  const latest = useRef(null); latest.current = { owner, prepare }
  useLayoutEffect(() => {
    const document = nodeRef.current?.ownerDocument
    if (!document) return
    const pending = new Set()
    const reset = event => {
      const node = nodeRef.current
      if (!node || latest.current.owner(node) !== event.target) return
      const complete = latest.current.prepare(node, event)
      if (!complete) return
      const task = setTimeout(() => {
        pending.delete(task)
        if (nodeRef.current === node) complete(!event.defaultPrevented && latest.current.owner(node) === event.target)
      }, 0)
      pending.add(task)
    }
    document.addEventListener('reset', reset, true)
    return () => { document.removeEventListener('reset', reset, true); pending.forEach(clearTimeout) }
  }, [nodeRef])
}

function prepareInputDefault(input, value) {
  const current = input.value, start = input.selectionStart, end = input.selectionEnd, direction = input.selectionDirection
  input.defaultValue = value
  if (input.value !== current) {
    input.value = current
    if (typeof start === 'number') input.setSelectionRange(start, end, direction)
  }
}
function removePasswordDefault(input) {
  if (input?.type !== 'password') return
  const current = input.value
  input.removeAttribute('value')
  if (input.value !== current) input.value = current
}

function useTextInput(props, forwardedRef, textarea = false) {
  const controlled = props.value !== undefined
  const initialDefault = useRef(props.defaultValue == null ? '' : String(props.defaultValue))
  const resetDefault = useRef(initialDefault.current), previousDefault = useRef(props.defaultValue)
  const defaultChanged = previousDefault.current !== props.defaultValue, oldDefault = resetDefault.current
  const nextDefault = !defaultChanged ? oldDefault : props.defaultValue != null ? String(props.defaultValue) :
    !textarea && Object.hasOwn(props, 'defaultValue') ? initialDefault.current : oldDefault
  const [local, setLocal] = useState(initialDefault.current)
  const node = useRef(null), generation = useRef(0), pending = useRef([]), latest = useRef(null)
  const pristine = useRef(false), passwordCleanup = useRef(false)
  latest.current = { controlled, value: props.value }
  const ref = useCallback(value => {
    node.current = inputNode(value)
    if (passwordCleanup.current) removePasswordDefault(node.current)
    writeRef(forwardedRef, node.current)
  }, [forwardedRef])
  useFormReset(node, input => input.form, (input, event) => {
    const version = generation.current
    const value = controlled ? String(props.value ?? '') : resetDefault.current
    const password = input.type === 'password', removedPasswordValue = password && !input.hasAttribute('value')
    // rc-input controls its native element even for defaultValue callers. Its
    // current value therefore became the DOM default; restore the real default
    // before the UA reset algorithm, without changing a cancelled reset's value.
    prepareInputDefault(input, value)
    const operation = { event, version, form: event.target, value, node: input }
    pending.current.push(operation)
    return accepted => {
      const index = pending.current.indexOf(operation)
      if (index !== -1) {
        pending.current.splice(index, 1)
        if (accepted && !latest.current.controlled && generation.current === version) { pristine.current = true; setLocal(operation.value) }
      }
      // Preserve Ant Design's password-attribute cleanup; removing an attribute
      // after reset must not clear the browser's now-pristine live value.
      if (removedPasswordValue) {
        passwordCleanup.current = true
        removePasswordDefault(input)
      }
    }
  })
  useLayoutEffect(() => {
    previousDefault.current = props.defaultValue; resetDefault.current = nextDefault
    const input = node.current
    if (!input) return
    if (!controlled && defaultChanged) {
      // After reset the native value is pristine: a new default also updates
      // that value, until another edit. Dirty values retain their current text.
      if (pristine.current && input.value === oldDefault) {
        input.value = resetDefault.current; setLocal(input.value)
      }
      if (input.type !== 'password') prepareInputDefault(input, resetDefault.current)
    }
    if (passwordCleanup.current) removePasswordDefault(input)
    const active = pending.current.findLast(operation => operation.node === input && operation.event.eventPhase !== 0)
    if (active) {
      // An onReset handler may synchronously render its parent before the UA
      // default action. rc-input must not replace the prepared default then.
      active.value = controlled ? String(props.value ?? '') : resetDefault.current
      prepareInputDefault(input, active.value)
    }
  })
  const operation = pending.current.findLast(operation => operation.event.eventPhase === 0 && !operation.event.defaultPrevented &&
    operation.version === generation.current && operation.node === node.current && node.current?.form === operation.form)
  const onChange = event => {
    generation.current += 1; pending.current = []; pristine.current = false; setLocal(event.target.value)
    props.onChange?.(event)
  }
  return { ...props, ref, value: controlled ? props.value : operation ? operation.value : local, onChange: controlled ? props.onChange : onChange }
}

const TextInput = forwardRef(function TextInput(props, ref) {
  const inputProps = useTextInput(props, ref)
  const { token } = theme.useToken()
  // Native date segments can exceed Input's text-derived padding height.
  // Keep the original picker and size its border box from the same theme.
  const style = props.type === 'date' ? { boxSizing: 'border-box',
    height: props.size === 'small' ? token.controlHeightSM : props.size === 'large' ? token.controlHeightLG : token.controlHeight,
    ...inputProps.style } : inputProps.style
  return <Input {...inputProps} style={style}/>
})

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

export const UiButton = forwardRef(function UiButton({ type, htmlType, variant, danger, size, density, layout, className = '', onClick, onMouseDown, ghost, children, ...props }, ref) {
  const inheritedDefaults = useContext(UiControlDefaultsContext)
  const fallbackTheme = useFallbackControlTheme()
  // These existing classes explicitly mean an icon without a text caption.
  // Ant Design only removes text padding when the content uses its icon slot.
  // An explicit icon prop still owns the slot and may accompany real children.
  const legacyIcon = !Object.hasOwn(props, 'icon') && children !== 0 &&
    (hasClass(className, 'icon-btn') || hasClass(className, 'icon-only'))
  const buttonIcon = legacyIcon ? children : props.icon
  const buttonChildren = legacyIcon ? undefined : children
  const iconOnly = Boolean(buttonIcon) && !buttonChildren && buttonChildren !== 0
  const structural = /(?:row|item|nav|menu|tab|swatch|handle|close|toggle|icon|chip|pill)/i.test(className) || ['tab', 'menuitem', 'option', 'treeitem'].includes(props.role)
  const kind = variant || (hasClass(className, 'primary') || type === 'primary' ? 'primary' : hasClass(className, 'link') || type === 'link' ? 'link' : hasClass(className, 'dashed') || type === 'dashed' ? 'dashed' : hasClass(className, 'text') || type === 'text' || structural ? 'text' : 'secondary')
  const nativeType = htmlType || (['button', 'submit', 'reset'].includes(type) ? type : type === undefined ? 'submit' : 'button')
  const buttonType = kind === 'primary' ? 'primary' : ['text', 'link', 'dashed'].includes(kind) ? kind : 'default'
  const guard = handler => event => { if (props.disabled || fieldsetDisabled(event.currentTarget)) { event.preventDefault(); event.stopPropagation(); return } handler?.(event) }
  const control = <Button {...props} icon={buttonIcon} ref={nativeRef(ref)} htmlType={nativeType} type={buttonType} danger={danger ?? hasClass(className, 'danger')} ghost={ghost ?? hasClass(className, 'ghost')} autoInsertSpace={false}
    size={controlSize(size, density, className)} data-ui-control="button" data-ui-layout={iconOnly ? 'icon' : layout === 'content' || structural ? 'content' : 'action'}
    aria-pressed={props['aria-pressed'] ?? (hasClass(className, 'active') ? true : undefined)}
    className={['app-ui-button', cleanControlClass(className)].filter(Boolean).join(' ')} onClick={guard(onClick)} onMouseDown={guard(onMouseDown)}>{buttonChildren}</Button>
  return inheritedDefaults ? control : <ConfigProvider wave={quietWave} theme={fallbackTheme}>{control}</ConfigProvider>
})

export const UiInput = forwardRef(function UiInput({ className = '', size, density, type = 'text', ...props }, ref) {
  if (nativeTypes.has(type)) return <input {...props} ref={ref} type={type} className={className} data-ui-native={type} />
  return <TextInput {...props} ref={ref} type={type} size={controlSize(size, density, className)} status={errorStatus(props)}
    data-ui-control="input" className={['app-ui-input', cleanControlClass(className)].filter(Boolean).join(' ')} />
})
export const UiPassword = forwardRef(function UiPassword({ className = '', size, density, type: _type, ...props }, ref) {
  const inputProps = useTextInput(props, ref)
  return <Input.Password {...inputProps} size={controlSize(size, density, className)} status={errorStatus(props)}
    data-ui-control="password" className={['app-ui-input', cleanControlClass(className)].filter(Boolean).join(' ')} />
})
export const UiTextarea = forwardRef(function UiTextarea({ className = '', size, density, ...props }, ref) {
  const inputProps = useTextInput(props, ref, true)
  return <Input.TextArea {...inputProps} size={controlSize(size, density, className)} status={errorStatus(props)}
    data-ui-control="textarea" className={['app-ui-input', cleanControlClass(className)].filter(Boolean).join(' ')} />
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
const defaultSelectPopupContainer = trigger => trigger.closest('[role="dialog"], [role="alertdialog"]') || trigger.ownerDocument.body

// Keep the normal placement gap and themed popup frame. Only the official
// option-list height shrinks, so long menus scroll inside the available side.
function useSelectListHeight(node, api, open, requestedHeight, padding, prefixCls) {
  const [availableHeight, setAvailableHeight] = useState(null)
  const measuredHeight = useRef(null)
  useLayoutEffect(() => {
    if (!open || !node || !Number.isFinite(requestedHeight) || requestedHeight <= 0) return
    const document = node.ownerDocument, window = document.defaultView
    let disposed = false
    const watched = new Set()
    const resize = window.ResizeObserver ? new window.ResizeObserver(() => update()) : null
    const watch = element => {
      if (element && !watched.has(element)) { watched.add(element); resize?.observe(element) }
    }
    const update = () => {
      if (disposed) return
      const trigger = api.current?.nativeElement, viewportHeight = document.documentElement.clientHeight
      if (!trigger || viewportHeight <= 0) return
      const triggerRect = trigger.getBoundingClientRect()
      if (triggerRect.height <= 0) return
      const field = node.querySelector('[role="combobox"]')
      let popup = document.getElementById(field?.getAttribute('aria-controls'))
      while (popup && !popup.classList.contains(`${prefixCls}-dropdown`)) popup = popup.parentElement
      let top = 0, bottom = viewportHeight, scale = 1, frame = padding * 2
      if (popup) {
        const popupRect = popup.getBoundingClientRect(), css = window.getComputedStyle(popup)
        if (popup.offsetHeight > 0 && popupRect.height > 0) scale = popupRect.height / popup.offsetHeight
        const pixels = value => Number.parseFloat(value)
        const dimensions = [css.paddingTop, css.paddingBottom].map(pixels)
        if (dimensions.every(Number.isFinite)) frame = dimensions.reduce((sum, value) => sum + value, 0) +
          (pixels(css.borderTopWidth) || 0) + (pixels(css.borderBottomWidth) || 0)
        watch(popup)
        // Match the popup's actual portal clipping ancestors, not the trigger's
        // scroll parents: a body portal may deliberately escape those parents.
        for (let parent = popup.parentElement; parent && parent !== document.body && parent !== document.documentElement; parent = parent.parentElement) {
          const style = window.getComputedStyle(parent)
          if (!/^(auto|scroll|hidden|clip)$/.test(style.overflowY || style.overflow)) continue
          const rect = parent.getBoundingClientRect()
          if (rect.height <= 0 || parent.offsetHeight <= 0) continue
          const parentScale = rect.height / parent.offsetHeight
          const innerTop = rect.top + parent.clientTop * parentScale
          top = Math.max(top, innerTop)
          bottom = Math.min(bottom, innerTop + parent.clientHeight * parentScale)
          watch(parent)
        }
      }
      const above = Math.max(0, Math.min(triggerRect.top, bottom) - top)
      const below = Math.max(0, bottom - Math.max(triggerRect.bottom, top))
      // A zero listHeight disables the library's max-height. Keep a positive
      // scroll viewport even when the surrounding window has almost no room.
      const height = Math.max(1, Math.floor((Math.max(above, below) - 4) / scale - frame))
      if (measuredHeight.current !== height) { measuredHeight.current = height; setAvailableHeight(height) }
      watch(trigger)
    }
    const mutations = new window.MutationObserver(update)
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] })
    mutations.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
    window.addEventListener('resize', update)
    document.addEventListener('scroll', update, true)
    update()
    return () => {
      disposed = true; mutations.disconnect(); resize?.disconnect()
      window.removeEventListener('resize', update)
      document.removeEventListener('scroll', update, true)
    }
  }, [node, api, open, requestedHeight, padding, prefixCls])
  return open && availableHeight !== null && Number.isFinite(requestedHeight) && requestedHeight > 0 ? Math.min(requestedHeight, availableHeight) : requestedHeight
}

export const UiSelect = forwardRef(function UiSelect({ className = '', style, size, density, onChange, onInput, options, children, multiple = false,
  value, defaultValue, disabled = false, name, form, required = false, id, onKeyDown, onInputKeyDown, onOpenChange, onDropdownVisibleChange,
  open: requestedOpen, showSearch, getPopupContainer, listHeight = 256, ...props }, forwardedRef) {
  const inheritedDefaults = useContext(UiControlDefaultsContext)
  const fallbackTheme = useFallbackControlTheme()
  const { token } = theme.useToken()
  const { getPrefixCls } = useContext(ConfigProvider.ConfigContext)
  // Own the ARIA identity instead of inheriting rc-util's shared test-id.
  // This is the same real React identity in every environment, not a test path.
  // Explicit caller IDs remain authoritative; IDs survive ordinary rerenders.
  const generatedId = useId()
  const selectId = id || `app-select-${generatedId}`
  const resolved = useMemo(() => normalOptions(options ?? selectOptions(children)), [options, children])
  const flat = useMemo(() => flatOptions(resolved), [resolved])
  const initial = () => normalValue(defaultValue ?? (multiple ? flat.filter(option => option.selected).map(option => option.value) : flat.find(option => option.selected)?.value ?? flat[0]?.value ?? ''))
  const controlled = value !== undefined
  const [local, setLocal] = useState(initial)
  const selected = controlled ? normalValue(value) : local
  const [node, setNode] = useState(null), api = useRef(null), resetNode = useRef(null), changeGeneration = useRef(0)
  const setSelectNode = useCallback(value => { resetNode.current = value; setNode(value) }, [])
  const inherited = useInheritedDisabled(node), blocked = disabled || inherited
  const [expanded, setExpanded] = useState(false)
  const latest = useRef(null); latest.current = { selected, controlled }
  useImperativeHandle(forwardedRef, () => ({ focus: options => api.current?.focus(options), blur: () => api.current?.blur(), nativeElement: node,
    get value() { return latest.current.selected }, get disabled() { return disabled || fieldsetDisabled(node) } }), [node, disabled])
  useEffect(() => { if (blocked) setExpanded(false) }, [blocked])
  useEffect(() => {
    if (!controlled && !multiple && !flat.some(option => option.value === local)) setLocal(flat[0]?.value ?? '')
  }, [controlled, multiple, flat, local])
  useFormReset(resetNode, node => node.querySelector('[data-ui-native="form-value"], [data-ui-native="form-validation"]')?.form ??
    (form !== undefined ? node.ownerDocument.getElementById(form) : node.closest('form')), () => {
    if (controlled) return
    const version = changeGeneration.current, value = initial()
    return accepted => {
      if (accepted && !latest.current.controlled && changeGeneration.current === version) { setLocal(value); setExpanded(false) }
    }
  })
  const change = next => {
    if (disabled || fieldsetDisabled(node)) return
    const result = normalValue(next)
    changeGeneration.current += 1
    if (!controlled) setLocal(result)
    const chosen = flat.filter(option => Array.isArray(result) ? result.includes(option.value) : result === option.value)
    const target = { value: Array.isArray(result) ? result[0] ?? '' : result, name: name ?? '', id: id ?? '', selectedIndex: flat.findIndex(option => option.value === (Array.isArray(result) ? result[0] : result)), options: flat, selectedOptions: chosen }
    const nativeEvent = new Event('change', { bubbles: true })
    const event = { type: 'change', target, currentTarget: target, nativeEvent, preventDefault: () => nativeEvent.preventDefault(), stopPropagation: () => nativeEvent.stopPropagation() }
    onInput?.({ ...event, type: 'input' }); onChange?.(event)
  }
  const open = requestedOpen ?? expanded
  const fittedListHeight = useSelectListHeight(node, api, open && !blocked, listHeight, token.Select?.paddingXXS ?? token.paddingXXS, getPrefixCls('select', props.prefixCls))
  const openRef = useRef(open); openRef.current = open
  const changeOpen = next => {
    const allowed = next && !disabled && !fieldsetDisabled(node)
    if (openRef.current === allowed) return
    openRef.current = allowed
    setExpanded(allowed)
    onOpenChange?.(allowed)
    onDropdownVisibleChange?.(allowed)
  }
  const key = event => {
    onInputKeyDown?.(event); onKeyDown?.(event)
    if (event.key === 'Escape' && open && !event.nativeEvent?.isComposing) { event.stopPropagation(); changeOpen(false) }
  }
  // Native form participation only: no hidden select or test-only interaction path.
  const values = Array.isArray(selected) ? selected : [selected]
  // The library owns pointer and keyboard activation. A second wrapper click
  // handler would reopen the popup just closed by Select's mousedown handler.
  const control = <span ref={setSelectNode} data-ui-control="select" data-ui-value={JSON.stringify(selected)} className={['app-ui-select-host', cleanControlClass(className)].filter(Boolean).join(' ')} style={style}>
    <Select {...props} virtual={false} optionRender={option => <span data-ui-option-value={String(option.value)}>{option.label}</span>} ref={api} id={selectId} aria-required={required || undefined} value={selected} options={resolved} disabled={blocked}
      mode={multiple ? 'multiple' : undefined} size={controlSize(size, density, className)} status={errorStatus(props)} className="app-ui-select"
      showSearch={showSearch ?? flat.length > 12} optionFilterProp="label" open={blocked ? false : open} onOpenChange={changeOpen} onChange={change} onInputKeyDown={key}
      listHeight={fittedListHeight} getPopupContainer={getPopupContainer || defaultSelectPopupContainer} />
    {name && values.map((item, index) => <input key={index} type="hidden" data-ui-native="form-value" name={name} form={form} value={item} disabled={blocked} />)}
    {required && <input className="app-ui-validation-field" data-ui-native="form-validation" type="text" aria-hidden="true" tabIndex={-1} form={form}
      value={values.some(item => item !== '') ? 'selected' : ''} readOnly={false} required disabled={blocked} onChange={() => {}}
      onInvalid={event => { event.preventDefault(); api.current?.focus() }} />}
  </span>
  return inheritedDefaults ? control : <ConfigProvider theme={fallbackTheme}>{control}</ConfigProvider>
})
