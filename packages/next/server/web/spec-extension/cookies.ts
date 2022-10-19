import type { CookieSerializeOptions } from '../types'

import cookie from 'next/dist/compiled/cookie'

export interface Cookie extends CookieSerializeOptions {
  /** A string representing the name of the cookie. */
  name: string
  /** A `string` representing the value of the cookie. */
  value: string | undefined
}

const normalizeCookieOptions = (options: CookieSerializeOptions) => {
  options = Object.assign({}, options)

  if (options.maxAge) {
    options.expires = new Date(Date.now() + options.maxAge * 1000)
  }

  if (options.path == null) {
    options.path = '/'
  }

  return options
}

const serializeValue = (value: unknown) =>
  typeof value === 'object' ? `j:${JSON.stringify(value)}` : String(value)

const serializeExpiredCookie = (
  key: string,
  options: CookieSerializeOptions = {}
) =>
  cookie.serialize(key, '', {
    expires: new Date(0),
    path: '/',
    ...options,
  })

const deserializeCookie = (input: Request | Response): string[] => {
  const value = input.headers.get('set-cookie')
  return value !== undefined && value !== null ? value.split(', ') : []
}

const serializeCookie = (input: string[]) => input.join(', ')

export class Cookies extends Map<string, string> {
  constructor(input?: string | null) {
    const parsedInput = typeof input === 'string' ? cookie.parse(input) : {}
    super(Object.entries(parsedInput))
  }
  set(key: string, value: unknown, options: CookieSerializeOptions = {}) {
    return super.set(
      key,
      cookie.serialize(
        key,
        serializeValue(value),
        normalizeCookieOptions(options)
      )
    )
  }
  [Symbol.for('edge-runtime.inspect.custom')]() {
    return Object.fromEntries(this.entries())
  }
}

export class NextCookies extends Cookies {
  response: Request | Response

  constructor(response: Request | Response) {
    super(response.headers.get('cookie'))
    this.response = response
  }
  get(...args: Parameters<Cookies['get']>) {
    return this.getWithOptions(...args).value
  }
  getAll(): Cookie[] {
    const all: Cookie[] = []
    for (const key of this.keys()) {
      all.push(this.getWithOptions(key))
    }
    return all
  }
  getWithOptions(...args: Parameters<Cookies['get']>): Cookie {
    const raw = super.get(...args)
    const name = args[0]
    if (typeof raw !== 'string') return { name, value: raw }
    const { [name]: value, ...options } = cookie.parse(raw)
    options.name = name
    options.value = value
    return options as unknown as Cookie
  }
  set(...args: Parameters<Cookies['set']>) {
    const isAlreadyAdded = super.has(args[0])

    super.set(...args)
    const currentCookie = super.get(args[0])

    if (typeof currentCookie !== 'string') {
      throw new Error(
        `Invariant: failed to generate cookie for ${JSON.stringify(args)}`
      )
    }

    if (isAlreadyAdded) {
      const setCookie = serializeCookie(
        deserializeCookie(this.response).filter(
          (value) => !value.startsWith(`${args[0]}=`)
        )
      )

      if (setCookie) {
        this.response.headers.set(
          'set-cookie',
          [currentCookie, setCookie].join(', ')
        )
      } else {
        this.response.headers.set('set-cookie', currentCookie)
      }
    } else {
      this.response.headers.append('set-cookie', currentCookie)
    }

    return this
  }
  delete(key: string, options: CookieSerializeOptions = {}) {
    const isDeleted = super.delete(key)

    if (isDeleted) {
      const setCookie = serializeCookie(
        deserializeCookie(this.response).filter(
          (value) => !value.startsWith(`${key}=`)
        )
      )
      const expiredCookie = serializeExpiredCookie(key, options)
      this.response.headers.set(
        'set-cookie',
        [expiredCookie, setCookie].join(', ')
      )
    }

    return isDeleted
  }
  clear(options: CookieSerializeOptions = {}) {
    const expiredCookies = Array.from(super.keys())
      .map((key) => serializeExpiredCookie(key, options))
      .join(', ')

    if (expiredCookies) this.response.headers.set('set-cookie', expiredCookies)
    return super.clear()
  }
}

export { CookieSerializeOptions }
