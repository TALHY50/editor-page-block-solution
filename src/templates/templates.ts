import template1Raw from './template-1-full.html?raw';

export type EditorTemplate = {
    id: string;
    name: string;
    rawHtml: string;
};

export const templates: EditorTemplate[] = [
    {
        id: 'template-1',
        name: 'Template 1',
        rawHtml: template1Raw,
    },
    {
        id: 'blank',
        name: 'Blank',
        rawHtml: '<p></p>',
    },
];

export const toEditorHtml = (rawHtml: string) => {
    const trimmed = rawHtml.trim().toLowerCase();
    if (!trimmed.startsWith('<html')) return rawHtml;

    const parsed = new DOMParser().parseFromString(rawHtml, 'text/html');
    return parsed.body?.innerHTML || rawHtml;
};
