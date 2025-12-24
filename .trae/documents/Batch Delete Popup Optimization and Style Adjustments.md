I have implemented the requested changes in `src/components/FileSelectorDialog.jsx`.

**1. Batch Delete Popup Optimization:**

* **Disabled Current Menu Item:**

  * Added logic to identify the current browsing menu item using `selectedFileId`.

  * Updated `renderNode` to disable the checkbox and apply specific styles (`color: #CCCCCC`, `cursor: not-allowed`) when the item matches the current file.

  * Added a tooltip `title="当前正在浏览的菜单项不可删除"` to the disabled item.

  * Updated `handleSelect` and `handleSelectAll` to prevent selecting the current file.

  * Updated initialization logic to ensure the current file is not selected by default when opening the dialog.

**2. Bottom Button Styles Adjustment:**

* **Layout:**

  * Updated `.modal-footer` to use Flexbox for centering (`justify-content: center`).

  * Added a `.btn-group` container for the buttons with `gap: 12px` to ensure consistent spacing between "Cancel" and "Delete".

  * Positioned the "Processing..." text absolutely to the left to avoid affecting the button centering.

**Verification:**

* The logic ensures that the current file cannot be selected or deleted via the batch delete popup.

* The styles match the requirements (greyed out, centered buttons, correct spacing).

