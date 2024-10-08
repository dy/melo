// parser converts syntax into AST/calltree
// NOTE: we don't import subscript features because we don't need its compiler
// also we may not need certain default operators like . or comments
// also we need adjusted precedences and parsing order
import parse, { lookup, skip, next, cur, idx, err, expr, token, unary, binary, access, group, nary, id } from 'subscript/parse'

export const INT = 'int', FLOAT = 'flt'

export default parse

// char codes
const OPAREN = 40, CPAREN = 41, OBRACK = 91, CBRACK = 93, SPACE = 32, QUOTE = 39, DQUOTE = 34, PERIOD = 46, BSLASH = 92, SLASH = 47, _0 = 48, _1 = 49, _8 = 56, _9 = 57, _A = 65, _F = 70, _a = 97, _f = 102, _E = 69, _e = 101, _b = 98, _o = 111, _x = 120, COLON = 58, SEMICOLON = 59, HASH = 35, AT = 64, PAREN_OPEN = 40, PAREN_CLOSE = 41, PLUS = 43, MINUS = 45, GT = 62

// precedences
const PREC_SEMI = 1, // a; b;
  PREC_RETURN = 4, // x ? ./a,b : y
  PREC_SEQ = 6, //  ./a,b,c;  a, b ? (c,d) : (e,f); a,b,c |> d
  PREC_STATE = 7, // *x=1, x=2;
  PREC_IF = 8,    // a ? b=c;  a = b?c;
  // FIXME: should pipe be lower than if? a |> b?c;
  PREC_PIPE = 8, // |> should match JS pipe, a = b|>c; a, b|>c, d; a|>b ? c
  PREC_ASSIGN = 8.25,  // a=b, c=d,  a = b||c,  a = b | c,   a = b&c
  PREC_LOR = 11,
  PREC_LAND = 12,
  PREC_BOR = 13, // a|b , c|d,   a = b|c
  PREC_XOR = 14,
  PREC_BAND = 15,
  PREC_EQ = 16,
  PREC_COMP = 17,
  PREC_SHIFT = 18,
  PREC_CLAMP = 19, // pre-arithmetical: a+b*c ~ 10; BUT a < b~c, a << b~c
  PREC_ADD = 20,
  PREC_RANGE = 22, // +a .. -b, a**2 .. b**3, a*2 .. b*3; BUT a + 2..b + 3
  PREC_MULT = 23,
  PREC_POW = 24,
  PREC_UNARY = 26,
  PREC_CALL = 27, // a(b), a.b, a[b], a[]
  PREC_TOKEN = 28 // [a,b] etc

// make id support #@
const isId = parse.id = char => id(char) || char === HASH

// numbers
const isNum = c => c >= _0 && c <= _9
const num = (a) => {
  if (a) err(); // abc 023 - wrong

  let n, t = INT, unit, node; // numerator, separator, denominator, unit

  // parse prefix
  n = next(c => c === _0 || c === _x || c === _o || c === _b)

  // 0x000
  if (n === '0x') n = parseInt(next(c => isNum(c) || (c >= _a && c <= _f) || (c >= _A && c <= _F)), 16)
  // 0o000
  else if (n === '0o') n = parseInt(next(c => c >= _0 && c <= _8), 8)
  // 0b000
  else if (n === '0b') n = parseInt(next(c => c === _1 || c === _0), 2)
  // 1.2, 1e3, -1e-3
  else {
    n += next(isNum)
    if (cur.charCodeAt(idx) === PERIOD && isNum(cur.charCodeAt(idx + 1))) n += skip() + next(isNum), t = FLOAT
    if (cur.charCodeAt(idx) === _E || cur.charCodeAt(idx) === _e) n += skip(2) + next(isNum)
    n = +n
    if (n != n) err(`Bad number ${n}`)
  }
  node = [t, n]

  // parse units, eg. 1s
  if (unit = next(c => !isNum(c) && isId(c))) node.push(unit)

  // parse unit combinations, eg. 1h2m3s
  if (isNum(cur.charCodeAt(idx))) node.push(num())

  return node
}

// .1
lookup[PERIOD] = a => !a && num();

// 0-9
for (let i = _0; i <= _9; i++) lookup[i] = num;


// strings
const escape = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v' },
  string = q => (qc, c, str = '') => {
    qc && err('Unexpected string') // must not follow another token
    skip() // first quote
    while (c = cur.charCodeAt(idx), c - q) {
      if (c === BSLASH) skip(), c = skip(), str += escape[c] || c
      else str += skip()
    }
    skip() || err('Bad string')
    return [, str]
  }


// "' with /
lookup[DQUOTE] = string(DQUOTE)
lookup[QUOTE] = string(QUOTE)


// a(b,c,d), a()
access('()', PREC_CALL)

// a[b]
access('[]', PREC_CALL)

// (a,b,c), (a)
group('()', PREC_CALL)
// [a,b,c]
group('[]', PREC_TOKEN)

// a,b,,c
nary(',', PREC_SEQ, true)
// a;b;;c
nary(';', PREC_SEMI, true)

// mults
binary('*', PREC_MULT)
binary('/', PREC_MULT)
binary('%', PREC_MULT)

// static
unary('*', PREC_STATE)

// adds
binary('+', PREC_ADD)
binary('-', PREC_ADD)
unary('+', PREC_UNARY)
unary('-', PREC_UNARY)

// increments
token('++', PREC_UNARY, a => a ? ['++', a] : ['+=', expr(PREC_UNARY - 1), [INT, 1]])
token('--', PREC_UNARY, a => a ? ['--', a] : ['-=', expr(PREC_UNARY - 1), [INT, 1]])

// bitwises
unary('~', PREC_UNARY)
binary('~', PREC_CLAMP)
binary('|', PREC_BOR)
binary('&', PREC_BAND)
binary('^', PREC_XOR)

// logic
binary('||', PREC_LOR)
binary('&&', PREC_LAND)
unary('!', PREC_UNARY)

// assigns
binary('=', PREC_ASSIGN, true)
binary('*=', PREC_ASSIGN, true)
binary('/=', PREC_ASSIGN, true)
binary('%=', PREC_ASSIGN, true)
binary('+=', PREC_ASSIGN, true)
binary('-=', PREC_ASSIGN, true)
binary('~=', PREC_ASSIGN, true)

// compares
binary('==', PREC_EQ)
binary('!=', PREC_EQ)
binary('>', PREC_COMP)
binary('<', PREC_COMP)
binary('>=', PREC_COMP)
binary('<=', PREC_COMP)

// shifts
binary('>>', PREC_SHIFT)
binary('<<', PREC_SHIFT)
binary('>>>', PREC_SHIFT)
binary('<<<', PREC_SHIFT)
binary('>>=', PREC_SHIFT)
binary('<<=', PREC_SHIFT)
binary('>>>=', PREC_SHIFT)
binary('<<<=', PREC_SHIFT)

// pow, mod
binary('**', PREC_POW, true)
binary('%%', PREC_MULT, true)

// clamps
binary('~<', PREC_CLAMP)
binary('~/', PREC_CLAMP)
binary('~*', PREC_CLAMP)
binary('~//', PREC_CLAMP)
binary('~**', PREC_CLAMP)

// loop a[..] |> #
nary('|>', PREC_PIPE)
// binary('|>=', PREC_PIPE, true)

// end a.; ;.;
// token('.', PREC_END, a => ['.', a])

// range a..b, ..b, a..
token('..', PREC_RANGE, a => (['..', a, expr(PREC_RANGE)]))

// returns
token('./', PREC_TOKEN, (a, b) => !a && (b = expr(PREC_RETURN), b ? ['./', b] : ['./'])) // continue: ./
token('../', PREC_TOKEN, (a, b) => !a && (b = expr(PREC_RETURN), b ? ['../', b] : ['../'])) // break: ../
token('/', PREC_TOKEN, (a, b) => !a && (b = expr(PREC_RETURN), b ? ['/', b] : ['/'])) // return: /

// defer ^a,b,c
unary('^', PREC_RETURN);

// a.b
// NOTE: we don't parse expression to avoid 0..1 recognizing as 0[.1]
// NOTE: for now we disable prop access since we don't have aliases and just static index can be done via x[0]
// token('.', PREC_CALL, (a,b) => a && (b=next(isId)) && ['.', a, b])

// conditions & ternary
// a?b - returns b if a is true, else returns a
binary('?', PREC_IF, true)
// binary('?:', PREC_IF, true)

// ?: - we use modified ternary for our cases
token('?', PREC_IF, (a, b, c) => a && (b = expr(PREC_IF - 0.5)) && next(c => c === COLON) && (c = expr(PREC_IF - 0.5), ['?:', a, b, c]))

// token('(;', PREC_TOKEN, (a, prec) => (next(c => c !== SEMICOLON && cur.charCodeAt(idx + 1) !== PAREN_CLOSE), skip(2), a || expr(prec) || []))
// ;; comments
token(';;', PREC_TOKEN, (a, prec) => (next(c => c >= SPACE), a || expr(prec) || []))
