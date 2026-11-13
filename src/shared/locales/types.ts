import type source from './zh-Hant'

/** Traditional Chinese is the source; its namespaces and keys are what every language has. */
export type Source = typeof source
export type Namespace = keyof Source

type Strings<T> = { [K in keyof T]: T[K] extends string ? string : Strings<T[K]> }
// English also needs the singular of every counted (`_other`) key; Chinese has only `_other`.
type Counted<T> = {
  [K in keyof T as K extends `${infer Key}_other` ? `${Key}_one` : never]: string
} & { [K in keyof T]: T[K] extends string ? string : Counted<T[K]> }

/** One namespace of a Chinese translation: exactly the source keys. */
export type Chinese<N extends Namespace> = Strings<Source[N]>
/** One English namespace: the source keys plus `_one` beside each `_other`. */
export type English<N extends Namespace> = Counted<Source[N]>
export type Translation<L extends 'zh-Hans' | 'en'> = {
  [N in Namespace]: L extends 'en' ? English<N> : Chinese<N>
}
