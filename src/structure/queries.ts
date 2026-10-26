import type { StructureLanguage } from './types.js'

const declarations: Partial<Record<StructureLanguage, string[]>> = {
  php: [
    '(class_declaration name: (_) @name) @declaration',
    '(function_definition name: (_) @name) @declaration',
    '(method_declaration name: (_) @name) @declaration',
  ],
  javascript: [
    '(function_declaration name: (_) @name) @declaration',
    '(class_declaration name: (_) @name) @declaration',
    '(method_definition name: (_) @name) @declaration',
    '(variable_declarator name: (_) @name) @declaration',
  ],
  typescript: [
    '(function_declaration name: (_) @name) @declaration',
    '(class_declaration name: (_) @name) @declaration',
    '(interface_declaration name: (_) @name) @declaration',
    '(type_alias_declaration name: (_) @name) @declaration',
    '(enum_declaration name: (_) @name) @declaration',
    '(method_definition name: (_) @name) @declaration',
    '(variable_declarator name: (_) @name) @declaration',
  ],
  tsx: [
    '(function_declaration name: (_) @name) @declaration',
    '(class_declaration name: (_) @name) @declaration',
    '(interface_declaration name: (_) @name) @declaration',
    '(type_alias_declaration name: (_) @name) @declaration',
    '(enum_declaration name: (_) @name) @declaration',
    '(method_definition name: (_) @name) @declaration',
    '(variable_declarator name: (_) @name) @declaration',
  ],
}

const imports: Partial<Record<StructureLanguage, string[]>> = {
  javascript: ['(import_statement) @import', '(export_statement) @export'],
  typescript: ['(import_statement) @import', '(export_statement) @export'],
  tsx: ['(import_statement) @import', '(export_statement) @export'],
}

const calls: Partial<Record<StructureLanguage, string[]>> = {
  javascript: ['(call_expression function: (_) @call) @callsite'],
  typescript: ['(call_expression function: (_) @call) @callsite'],
  tsx: ['(call_expression function: (_) @call) @callsite'],
}

export type RegisteredQueryId = 'declarations' | 'calls' | 'imports'

export function getRegisteredQuery(language: StructureLanguage, queryId: string): string | undefined {
  const patterns = queryId === 'declarations' ? declarations[language] : queryId === 'calls' ? calls[language] : queryId === 'imports' ? imports[language] : undefined
  return patterns?.join('\n')
}

export function isRegisteredQueryId(value: string): value is RegisteredQueryId {
  return value === 'declarations' || value === 'calls' || value === 'imports'
}
