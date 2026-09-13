import Image from '@tiptap/extension-image'

export const EditorImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      storagePath: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-storage-path'),
        renderHTML: (attrs) => (attrs.storagePath ? { 'data-storage-path': attrs.storagePath } : {}),
      },
      align: { default: 'center' },
      wrap: { default: 'none' },
      rotation: { default: 0 },
    }
  },
}).configure({
  inline: false,
  allowBase64: false,
  resize: {
    enabled: true,
    alwaysPreserveAspectRatio: true,
    minWidth: 48,
    minHeight: 48,
  },
})
