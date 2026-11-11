import React, { StrictMode, act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UiSelect } from './ControlKit'
import { openUiSelect, setUiValue, uiValue } from '~/test/uiControlDriver'

let root, container
const field = label => container.querySelector(`[role="combobox"][aria-label="${label}"]`)
const options = [{ value: '', label: 'Choose' }, { value: 'one', label: 'One' }, { value: 'two', label: 'Two' }]
const render = async element => act(async () => root.render(element))
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('real Select identity and popup ownership', () => {
  it('keeps generated IDs unique and stable while preserving explicit IDs', async () => {
    const view = disabled => <StrictMode>
      <UiSelect aria-label="left" options={options} disabled={disabled} />
      <UiSelect aria-label="right" options={options} />
      <UiSelect aria-label="explicit" id="caller-owned-id" options={options} />
    </StrictMode>
    await render(view(false))
    const before = ['left', 'right', 'explicit'].map(label => field(label).id)
    expect(before.every(Boolean)).toBe(true)
    expect(new Set(before).size).toBe(3)
    expect(field('explicit').id).toBe('caller-owned-id')
    await render(view(true))
    expect(['left', 'right', 'explicit'].map(label => field(label).id)).toEqual(before)
  })

  it('resolves each real popup through its own unique aria-controls reference', async () => {
    await render(<div role="dialog">
      <UiSelect aria-label="left" options={[{ value: 'left-only', label: 'Left only' }]} />
      <UiSelect aria-label="right" options={[{ value: 'right-only', label: 'Right only' }]} />
    </div>)
    const left = await openUiSelect(field('left'))
    const leftId = field('left').getAttribute('aria-controls')
    expect(left).toBe(document.getElementById(leftId))
    const right = await openUiSelect(field('right'))
    const rightId = field('right').getAttribute('aria-controls')
    expect(rightId).not.toBe(leftId)
    expect(right).toBe(document.getElementById(rightId))
    expect([...right.querySelectorAll('[data-ui-option-value]')].map(node => node.dataset.uiOptionValue)).toEqual(['right-only'])
  })

  it('selects equal-valued options on the intended control, not a retained sibling popup', async () => {
    const leftChange = vi.fn(), rightChange = vi.fn()
    await render(<><UiSelect aria-label="left" options={options} onChange={leftChange} />
      <UiSelect aria-label="right" options={options} onChange={rightChange} /></>)
    await setUiValue(field('left'), 'one')
    await setUiValue(field('right'), 'two')
    expect(uiValue(field('left'))).toBe('one')
    expect(uiValue(field('right'))).toBe('two')
    expect(leftChange).toHaveBeenCalledTimes(1)
    expect(rightChange).toHaveBeenCalledTimes(1)
    expect(leftChange.mock.calls[0][0].target.value).toBe('one')
    expect(rightChange.mock.calls[0][0].target.value).toBe('two')
  })

  it('does not reset the base when selecting the second half of a controlled comparison', async () => {
    function Comparison() {
      const [base, setBase] = useState(''), [target, setTarget] = useState('')
      return <><UiSelect aria-label="base" value={base} options={options} onChange={event => { setBase(event.target.value); setTarget('') }} />
        <UiSelect aria-label="target" value={target} disabled={!base} options={options} onChange={event => setTarget(event.target.value)} />
        <output aria-label="pair">{base + '->' + target}</output></>
    }
    await render(<Comparison />)
    await setUiValue(field('base'), 'one')
    await setUiValue(field('target'), 'two')
    expect(container.querySelector('output').textContent).toBe('one->two')
    expect(uiValue(field('base'))).toBe('one')
    expect(uiValue(field('target'))).toBe('two')
  })
})
