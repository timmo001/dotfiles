export interface Repo {
  readonly name: string
  readonly path: string
}

export interface RepoState {
  readonly changed: readonly Repo[]
  readonly unchanged: readonly Repo[]
  readonly lastChecked: Date
}
