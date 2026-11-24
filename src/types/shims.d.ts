/**
 * App version from `package.json`, injected at build time by
 * `define: { __APP_VERSION__ }` in `vite.config.ts`.
 */
declare const __APP_VERSION__: string

declare module 'vue3-gettext' {
  export function useGettext(): {
    $gettext: (text: string, params?: Record<string, string | number>) => string
    /**
     * Plural form (`$ngettext(singular, plural, n, params)`). Declared here so
     * call sites stay type-checked without going through a wrapper.
     */
    $ngettext: (
      singular: string,
      plural: string,
      n: number,
      params?: Record<string, string | number>
    ) => string
    current: string
  }
}

/**
 * Vite resolves these at build time. TypeScript 6 reports a side-effect import of
 * an untyped file (TS2882, `noUncheckedSideEffectImports` default), so glob the
 * stylesheets the views/components import explicitly.
 */
declare module '*.css'

/**
 * SVG files imported as a URL (`src/brandIcon.ts`, `?url`): Vite emits the file
 * and hands over its URL, so the import is a plain string.
 */
declare module '*.svg?url' {
  const url: string
  export default url
}

/**
 * Minimal declarations for the OpenCloud host packages: only what this
 * extension imports, typed as precisely as the host documents it, so the app
 * code can be checked without the full web-pkg/web-client type surface.
 */
declare module '@opencloud-eu/web-pkg' {
  import type { Component, Ref } from 'vue'
  import type { RouteLocationNormalizedLoaded, RouteRecordRaw, Router } from 'vue-router'

  /** Host router (vue-router is not shared with extensions — never import its composables). */
  export function useRouter(): Router
  export function useRoute(): Ref<RouteLocationNormalizedLoaded>

  export function defineWebApplication(options: {
    setup: (options: ApplicationSetupOptions) => WebApplicationSetup
  }): WebApplicationSetup

  /** Attributes the platform hands to a custom modal component (`modal` prop). */
  export interface ModalInstance {
    id: string
  }

  /** What `dispatchModal` accepts; every key we ever pass at a call site. */
  export interface ModalOptions {
    title?: string
    message?: string
    confirmText?: string
    cancelText?: string
    /** Hide the modal shell's own footer (the hosted component brings its own). */
    hideActions?: boolean
    /** Component rendered inside the modal shell. */
    customComponent?: Component
    /** Attributes for `customComponent`, evaluated per render. */
    customComponentAttrs?: (instance?: ModalInstance) => Record<string, unknown>
    onConfirm?: () => void | Promise<void>
    onCancel?: () => void | Promise<void>
  }

  export function useModals(): {
    dispatchModal: (options: ModalOptions) => ModalInstance
    removeModal: (id: string) => void
  }

  /** Toast options; `title` is rendered bold, `desc` as the second line. */
  export interface MessageOptions {
    title: string
    desc?: string
  }

  export function useMessages(): {
    showMessage: (options: MessageOptions) => void
    showErrorMessage: (options: MessageOptions) => void
  }

  /** A file read through the host's webdav client (`responseType` defaults to text). */
  export interface FileContentsResponse {
    body: string | ArrayBuffer | Blob
  }

  export function useClientService(): {
    webdav: {
      getFileContents: (
        space: unknown,
        options: { fileId?: string; path?: string },
        opts?: { responseType?: string }
      ) => Promise<FileContentsResponse>
    }
  }

  /**
   * CASL ability of the current user. Administrators are detected with
   * `useAbility().can('read-all', 'Setting')` — captured at `setup()`, never in a
   * handler.
   */
  export function useAbility(): { can: (action: string, subject: string) => boolean }

  export function useAuthStore(): { accessToken: string }

  /** Current user, as read by the "connect devices" hint. */
  export interface UserStore {
    user: { onPremisesSamAccountName?: string; displayName?: string } | null
  }

  export function useUserStore(): UserStore

  export interface ApplicationTranslations {
    [lang: string]: { [key: string]: string | string[] }
  }

  /**
   * An icon as the host takes it: the name of an icon from the icon set, a named
   * icon, or an image icon (`src` is rendered as an `<img>`, `srcDark` in dark
   * mode). Only the shapes this app passes are declared.
   */
  export type Icon =
    string | { name: string; fillType?: string; color?: string } | { src: string; srcDark?: string }

  /** What `defineWebApplication`'s `setup` returns (the host registers it). */
  export interface WebApplicationSetup {
    appInfo: { id: string; name: string; icon?: Icon; color?: string }
    navItems?: AppNavigationItem[]
    routes?: RouteRecordRaw[]
    extensions?: Extension[] | Ref<Extension[]>
    translations?: ApplicationTranslations
  }

  export interface AppMenuItemExtension {
    id: string
    type: string
    label: () => string
    /** Tile colour the host paints behind the icon (`OcApplicationIcon`). */
    color?: string
    icon?: Icon
    path: string
    /** Ordering of the entries in the app menu (ascending). */
    priority?: number
  }

  /** `apps.yaml` → `applicationConfig` as the host passes it to `setup`. */
  export interface ApplicationSetupOptions {
    applicationConfig?: { config?: Record<string, unknown> }
  }

  export interface Extension {
    id: string
    type: string
    /** Extension points this extension is exposed on (`global.files.context-actions`, …). */
    extensionPointIds?: string[]
  }

  /**
   * Left-sidebar entry extension (`sidebarNav`), used for the Files app's
   * `app.files.navItems` extension point. Declared here because the module
   * declaration shadows web-pkg's own types.
   */
  export interface SidebarNavExtension extends Extension {
    type: 'sidebarNav'
    navItem: AppNavigationItem
  }

  /**
   * The slice of a Files-app resource an action reads. The generic parameters of
   * `Action`/`FileAction` default to the app's own resource type at every call
   * site, so only these fields are known here.
   */
  export interface FileActionResource {
    id?: string
    name?: string
    path?: string
    mimeType?: string
  }

  /** Files-app action options: the space plus the selected resources. */
  export interface FileActionOptions<T = FileActionResource> {
    space?: unknown
    resources?: T[]
  }

  /**
   * An action shown in the Files app (context menu, toolbar, …).
   *
   * `T` is the options type of the handler; the app instantiates it with its own
   * `FileActionOptions<SomeResource>`, so the default stays the generic options
   * shape rather than a concrete resource.
   */
  export interface Action<T = FileActionOptions> {
    name: string
    icon: string | ((options?: T) => string)
    label: (options?: T) => string
    isVisible: (options?: T) => boolean
    handler?: (options?: T) => Promise<void> | void
    category?: string
    hasPriority?: boolean
    id?: string
    hideLabel?: boolean
    isDisabled?: (options?: T) => boolean
  }

  /**
   * One registered Files-app action. Declared without a generic argument on
   * purpose: the host stores `action` as an opaque object, so an action for a
   * specific resource type must be assignable to this one. TypeScript cannot
   * express that with a concrete parameter (`handler` is contravariant), hence
   * the `any` footgun is avoided by leaving `Action`'s parameter at its generic
   * default here.
   */
  export type FileAction<T = FileActionResource> = Action<FileActionOptions<T>>

  export interface ActionExtension extends Extension {
    type: 'action'
    action: FileAction
  }

  /** One sidebar entry (in-app nav list and `sidebarNav` extensions). */
  export interface AppNavigationItem {
    name: string
    icon?: Icon
    route?: { path: string; name?: string }
    /** Paths that highlight the entry in addition to its own `route`. */
    activeFor?: { path?: string; name?: string }[]
    priority?: number
    /** `false` keeps the entry from ever being rendered as the active page. */
    isActive?: () => boolean
    isVisible?: () => boolean
  }
}

/**
 * @event-calendar/core – only the surface the calendar view drives.
 * `setOption` takes whatever option value the view has (event arrays, date
 * strings, toolbar descriptors), so the value type is `unknown`.
 */
declare module '@event-calendar/core' {
  /** A calendar plugin (TimeGrid, DayGrid, List, Interaction, …). */
  export type CalendarPlugin = unknown

  /** The instance `createCalendar` returns; the view only calls these methods. */
  export interface CalendarInstance {
    setOption: (name: string, value: unknown) => void
    unselect: () => void
  }

  export function createCalendar(
    el: HTMLElement,
    plugins: CalendarPlugin[],
    options: Record<string, unknown>
  ): CalendarInstance
  export function destroyCalendar(calendar: CalendarInstance): void
  export const TimeGrid: CalendarPlugin
  export const DayGrid: CalendarPlugin
  export const List: CalendarPlugin
  export const Interaction: CalendarPlugin
}
