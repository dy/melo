// builder actually generates wast code from params / current context
import { globals, locals, funcs, func, initing, returns, RETURN } from "./compile.js"
import { err } from "./util.js"
import stdlib from "./stdlib.js"
import { FLOAT, INT } from "./parse.js"

export const i32 = {
  const: a => op(`(i32.const ${a})`, 'i32'),
  load: a => op(`(i32.load ${a})`, 'i32'),
  store: (a, v) => op(`(i32.store ${a} ${v})`),
  add: (a, b) => op(`(i32.add ${a} ${b})`, 'i32'),
  sub: (a, b) => op(`(i32.sub ${a} ${b})`, 'i32'),
  eqz: (a) => op(`(i32.eqz ${a})`, 'i32')
}

export const f64 = {
  const: a => op(`(f64.const ${a})`, 'f64'),
  load: a => op(`(f64.load ${a})`, 'f64'),
  store: (a, v) => op(`(f64.store ${a} ${v})`),
  add: (a, b) => op(`(f64.add ${a} ${b})`, 'f64'),
  sub: (a, b) => op(`(f64.sub ${a} ${b})`, 'f64'),
  lt: (a, b) => op(`(f64.lt ${a} ${b})`, 'i32')
}

// if then else?
export function cond(i, a, b) {
  let result = a.type ? `(result ${a.type.join(' ')})` : ``
  return op(`(if ${result} ${i} (then ${a}) ${b ? `(else ${b})` : ``})`, a.type)
}

// (loop)
export function loop(body) {
  return op(`(loop ${body})`)
}

// create op result, a string with extra info like types
// holds number of returns (ops)
// makes sure it stringifies properly into wasm expression
// provides any additional info: types, static, min/max etc
export function op(str = '', type) {
  str = new String(str)
  if (!type) type = []
  else if (typeof type === 'string') type = [type]
  return Object.assign(str, { type })
}

// (local.get) or (global.get)
export function get(name) {
  // global
  if ((!func && name[0] !== '_') || globals[name]) return globals[name] ||= { type: 'f64' }, op(`(global.get $${name})`, globals[name].type)

  // static
  if (locals[name].static) return op(`(global.get $${locals[name].static})`, locals[name].type)

  // local
  return locals[name] ||= { type: 'f64' }, op(`(local.get $${name})`, locals[name].type)
}

// (local.set) or (global.set) (if no init - takes from stack)
export function set(name, init = '') {
  // global
  // TODO: disable for the first fn expression
  if ((!func && name[0] !== '_') || (!initing && globals[name])) return globals[name] ||= { type: init.type || 'f64' }, op(`(global.set $${name} ${init})`)

  // static
  if (locals[name].static) return op(`(global.set $${locals[name].static} ${init})`)

  // local
  return locals[name] ||= { type: init.type || 'f64' }, op(`(local.set $${name} ${init})`)
}

// (local.tee) or (global.set)(global.get)
export function tee(name, init = '') {
  // global
  if ((!func && name[0] !== '_') || (!initing && globals[name])) return globals[name] ||= { type: init.type || 'f64' }, op(`(global.set $${name} ${init})(global.get $${name})`, init.type)

  // static
  if (locals[name].static) return op(`(global.set $${locals[name].static} ${init})(global.get $${locals[name].static})`, locals[name].type)

  return locals[name] ||= { type: init.type || 'f64' }, op(`(local.tee $${name} ${init})`, init.type)
}

// produce function call method
export function call(name, ...args) {
  if (!funcs[name]) err(`Unknown function call '${name}'`)
  return op(`(call $${name} ${args.join(' ')})`, funcs[name].type)
}

// add include from stdlib and return call
// NOTE: we cannot remove it due to circular deps
export function include(name) {
  if (!stdlib[name]) err('Unknown include `' + name + '`')
  // parse type from first (result) token
  // FIXME: must be done better
  let code = stdlib[name]
  let type = code.match(/\(result\s+([^\)]+)\)/i)?.[1].trim().split(/\s+/)
  if (!funcs[name]) defineFn(name, code, type)
}

// define a function
export function defineFn(name, body, type) {
  if (funcs[name]) err(`Redefine func \`${name}\``)
  funcs[name] = new String(body)
  funcs[name].type = type
}

// upgrade/extend type of a to include type b (length and f64)
export function uptype(a, b) {
  // we upgrade type to f64 if it mismatches
  if (a.length < b.length) a.length = b.length
  for (let i = 0, l = b.length; i < l; i++)
    if (a[i] !== b[i]) a[i] = 'f64'
}

// make sure operation has provided type in stack
// unlike float/int it provides generic type enforcement
// eg. 1,2 + f64,
export function type(opStr, type) {
  let dif = type.findIndex((t, i) => opStr.type[i] != t) // first different type

  if (dif < 0) return opStr

  // if dif type is last in op - upgrade it and fill rest with nans, eg.
  // /1; /1.1 - single type mismatch
  // /1,2; /1,2.2 - last type mismatch
  if (dif >= opStr.type.length - 1) {
    opStr = float(opStr)
    // fill up stack with 0
    // /1; /1,2 - length mismatch
    // /1,2; /1,2.2,3 - length and last type mismatch
    for (let i = opStr.type.length; i < type.length; i++) opStr += `(${type[i]}.const nan)`
    return op(opStr, type)
  }
  // /1; /1.1,2 - type and/or length mismatch - needs temp vars
  else {
    // /1,2; /1.1,2 - one var type mismatch
    err('Unimplemented return type mismatch')
  }
}

// wrap expression to float, if needed
export function float(opStr) {
  if (opStr.type[0] === 'f64') return opStr
  if (opStr == RETURN) return opStr // ignore return placeholders
  if (opStr.startsWith('(i32.const')) return op(opStr.replace('(i32.const', '(f64.const'), 'f64')
  return op(`(f64.convert_i32_s ${opStr})`, 'f64')
}
// cast expr to int
export function int(opStr) {
  if (opStr.type[0] === 'i32') return opStr
  if (opStr == RETURN) return opStr // ignore return placeholders
  return op(`(i32.trunc_f64_s ${opStr})`, 'i32')
}

/**
 * Pick N input args into stack, like (a,b,c) -> (a,b)
 *
 * @param {number} count - number of elements to pick
 * @param {string} input - stringified op to pick elements from
 * @returns {string}
 */
export function pick(count, input) {
  // (a,b,c) = d - we duplicate d to stack N times
  if (input.type.length === 1) {
    // a = b - skip picking
    if (count === 1) return input
    // (a,b,c) = d - duplicating via tmp var is tentatively faster & more compact than calling a dup function
    // FIXME: can be single global variable
    const name = `dup:${input.type[0]}`
    locals[name] ||= { type: input.type[0] }
    return op(
      `(local.set $${name} ${input})${`(local.get $${name})`.repeat(count)}`,
      Array(count).fill(input.type[0])
    )
  }

  // (a,b) = (c,d) - avoid picking since result is directly put into stack
  if (input.type.length === count) return input

  // (a,b) = (c,d,e) – drop redundant members
  if (count < input.type.length) return op(input + `(drop)`.repeat(input.type.length - count), input.type.slice(0, count))

  // (a,b,c) = (d,e) – pick a & b, skip c
  if (count > input.type.length) err('Picking more members than available')

  // NOTE: repeating els like (a,b,c)=(b,c,a) are not a threat, we don't need a function
  // putting them directly to stack is identical to passing to pick(b,c,a) as args
}

// check if node is statically precalculable (see extended constants expressions)
export const isConstExpr = (a) => //(typeof a === 'string' && globals[a]) ||
  a[0] === INT || a[0] === FLOAT
// || ((a[0] === '+' || a[0] === '-' || a[0] === '*') && a.slice(1).every(isConstExpr))
