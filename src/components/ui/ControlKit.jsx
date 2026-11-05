import React, { forwardRef, Children } from 'react'
import { Button, Input, Select } from 'antd'

/** Shared Ant Design adapters. Keep DOM event semantics for existing form handlers. */
export const UiButton = forwardRef(function UiButton({ variant = 'secondary', danger = false, className = '', ...props }, ref) {
  const type = variant === 'primary' ? 'primary' : variant === 'text' ? 'text' : 'default'
  return <Button ref={ref} type={type} danger={danger} className={['app-ui-button', className].filter(Boolean).join(' ')} {...props} />
})

export const UiInput = forwardRef(function UiInput({ className = '', onChange, ...props }, ref) {
  return <Input ref={ref} className={['app-ui-input', className].filter(Boolean).join(' ')} onChange={onChange} {...props} />
})

export const UiPassword = forwardRef(function UiPassword({ className = '', onChange, ...props }, ref) {
  return <Input.Password ref={ref} className={['app-ui-input', className].filter(Boolean).join(' ')} onChange={onChange} {...props} />
})

export const UiTextarea = forwardRef(function UiTextarea({ className = '', onChange, ...props }, ref) {
  return <Input.TextArea ref={ref} className={['app-ui-input', className].filter(Boolean).join(' ')} onChange={onChange} {...props} />
})

export const UiSelect = forwardRef(function UiSelect({ className = '', onChange, options, children, ...props }, ref) {
  const childOptions = Children.toArray(children).flatMap(child => {
    if (!React.isValidElement(child) || child.type !== 'option') return []
    const label = child.props.children
    return [{ value: child.props.value ?? label, label, disabled: Boolean(child.props.disabled), title: child.props.title }]
  })
  const resolvedOptions = options ?? (childOptions.length ? childOptions : undefined)
  return <Select ref={ref} className={['app-ui-select', className].filter(Boolean).join(' ')} options={resolvedOptions} onChange={(value, option) => onChange?.({ target: { value }, currentTarget: { value }, nativeEvent: null, option })} {...props} />
})
