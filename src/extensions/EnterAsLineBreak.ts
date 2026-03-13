import { Extension } from '@tiptap/core';

export const EnterAsLineBreak = Extension.create({
    name: 'enterAsLineBreak',
    priority: 1000,

    addKeyboardShortcuts() {
        return {
            Enter: () =>
                this.editor.commands.first([
                    () => this.editor.commands.splitBlock(),
                    () => (this.editor.commands as any).setHardBreak(),
                ]),
        };
    },
});
