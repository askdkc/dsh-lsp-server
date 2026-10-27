import type { StructureLanguage } from './types.js'

// TypeScript and TSX share one grammar family, so TSX accepts the same patterns.
const TS_DECLARATIONS = [
  '(function_declaration name: (_) @name) @declaration',
  '(class_declaration name: (_) @name) @declaration',
  '(interface_declaration name: (_) @name) @declaration',
  '(type_alias_declaration name: (_) @name) @declaration',
  '(enum_declaration name: (_) @name) @declaration',
  '(method_definition name: (_) @name) @declaration',
  '(variable_declarator name: (_) @name) @declaration',
]

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
  typescript: TS_DECLARATIONS,
  tsx: TS_DECLARATIONS,
  bash: ['(function_definition name: (word) @name) @declaration'],
  c: [
    '(function_definition declarator: (function_declarator declarator: (identifier) @name)) @declaration',
    '(struct_specifier name: (type_identifier) @name) @declaration',
    '(union_specifier name: (type_identifier) @name) @declaration',
    '(enum_specifier name: (type_identifier) @name) @declaration',
  ],
  cpp: [
    '(class_specifier name: (type_identifier) @name) @declaration',
    '(struct_specifier name: (type_identifier) @name) @declaration',
    '(union_specifier name: (type_identifier) @name) @declaration',
    '(enum_specifier name: (type_identifier) @name) @declaration',
    '(namespace_definition name: (namespace_identifier) @name) @declaration',
    '(function_definition declarator: (function_declarator declarator: [(identifier) (field_identifier) (qualified_identifier)] @name)) @declaration',
  ],
  c_sharp: [
    '(class_declaration name: (identifier) @name) @declaration',
    '(interface_declaration name: (identifier) @name) @declaration',
    '(struct_declaration name: (identifier) @name) @declaration',
    '(enum_declaration name: (identifier) @name) @declaration',
    '(record_declaration name: (identifier) @name) @declaration',
    '(method_declaration name: (identifier) @name) @declaration',
  ],
  css: ['(rule_set (selectors) @name) @declaration'],
  go: [
    '(function_declaration name: (identifier) @name) @declaration',
    '(method_declaration name: (field_identifier) @name) @declaration',
    '(type_spec name: (type_identifier) @name) @declaration',
  ],
  haskell: [
    '(signature name: (variable) @name) @declaration',
    '(function name: (variable) @name) @declaration',
    '(data_type name: (name) @name) @declaration',
    '(newtype name: (name) @name) @declaration',
    '(type_synomym name: (name) @name) @declaration',
    '(class name: (name) @name) @declaration',
  ],
  html: ['(element (start_tag (tag_name) @name)) @declaration'],
  java: [
    '(class_declaration name: (identifier) @name) @declaration',
    '(interface_declaration name: (identifier) @name) @declaration',
    '(enum_declaration name: (identifier) @name) @declaration',
    '(record_declaration name: (identifier) @name) @declaration',
    '(annotation_type_declaration name: (identifier) @name) @declaration',
    '(method_declaration name: (identifier) @name) @declaration',
  ],
  json: ['(pair key: (string) @name) @declaration'],
  julia: [
    '(function_definition (signature (call_expression (identifier) @name))) @declaration',
    '(struct_definition (type_head (identifier) @name)) @declaration',
    '(abstract_definition (type_head (identifier) @name)) @declaration',
    '(macro_definition (signature (call_expression (identifier) @name))) @declaration',
  ],
  ocaml: [
    '(value_definition (let_binding pattern: (value_name) @name)) @declaration',
    '(type_definition (type_binding name: (type_constructor) @name)) @declaration',
    '(module_definition (module_binding (module_name) @name)) @declaration',
  ],
  ocaml_interface: [
    '(value_specification (value_name) @name) @declaration',
    '(type_definition (type_binding name: (type_constructor) @name)) @declaration',
    '(module_definition (module_binding (module_name) @name)) @declaration',
  ],
  python: [
    '(class_definition name: (identifier) @name) @declaration',
    '(function_definition name: (identifier) @name) @declaration',
  ],
  ql_dbscheme: ['(table tableName: (tableName) @name) @declaration'],
  ruby: [
    '(class name: (constant) @name) @declaration',
    '(module name: (constant) @name) @declaration',
    '(method name: (identifier) @name) @declaration',
    '(singleton_method name: (identifier) @name) @declaration',
  ],
  rust: [
    '(function_item name: (identifier) @name) @declaration',
    '(struct_item name: (type_identifier) @name) @declaration',
    '(enum_item name: (type_identifier) @name) @declaration',
    '(trait_item name: (type_identifier) @name) @declaration',
    '(mod_item name: (identifier) @name) @declaration',
    '(type_item name: (type_identifier) @name) @declaration',
  ],
  scala: [
    '(class_definition name: (identifier) @name) @declaration',
    '(object_definition name: (identifier) @name) @declaration',
    '(trait_definition name: (identifier) @name) @declaration',
    '(function_definition name: (identifier) @name) @declaration',
  ],
}

const imports: Partial<Record<StructureLanguage, string[]>> = {
  javascript: ['(import_statement) @import', '(export_statement) @export'],
  typescript: ['(import_statement) @import', '(export_statement) @export'],
  tsx: ['(import_statement) @import', '(export_statement) @export'],
  python: ['(import_statement) @import', '(import_from_statement) @import'],
  go: ['(import_declaration) @import'],
  rust: ['(use_declaration) @import'],
  java: ['(import_declaration) @import'],
  c_sharp: ['(using_directive) @import'],
  cpp: ['(preproc_include) @import'],
  c: ['(preproc_include) @import'],
  scala: ['(import_declaration) @import'],
  julia: ['(import_statement) @import', '(using_statement) @import'],
}

const calls: Partial<Record<StructureLanguage, string[]>> = {
  javascript: ['(call_expression function: (_) @call) @callsite'],
  typescript: ['(call_expression function: (_) @call) @callsite'],
  tsx: ['(call_expression function: (_) @call) @callsite'],
  python: ['(call function: (_) @call) @callsite'],
  go: ['(call_expression function: (_) @call) @callsite'],
  rust: ['(call_expression function: (_) @call) @callsite'],
  java: ['(method_invocation name: (_) @call) @callsite'],
  c_sharp: ['(invocation_expression function: (_) @call) @callsite'],
  cpp: ['(call_expression function: (_) @call) @callsite'],
  c: ['(call_expression function: (_) @call) @callsite'],
  ruby: ['(call method: (_) @call) @callsite'],
  scala: ['(call_expression function: (_) @call) @callsite'],
  julia: ['(call_expression (identifier) @call) @callsite'],
}

export type RegisteredQueryId = 'declarations' | 'calls' | 'imports'

export function getRegisteredQuery(language: StructureLanguage, queryId: string): string | undefined {
  const patterns = queryId === 'declarations' ? declarations[language] : queryId === 'calls' ? calls[language] : queryId === 'imports' ? imports[language] : undefined
  return patterns?.join('\n')
}

export function isRegisteredQueryId(value: string): value is RegisteredQueryId {
  return value === 'declarations' || value === 'calls' || value === 'imports'
}
