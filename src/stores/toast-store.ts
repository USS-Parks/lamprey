import { create } from 'zustand'

export type ToastType = 'success' | 'warning' | 'error' | 'info'

export interface Toast {
  id: number
  type: ToastType
  message: string
  duration: number
}

interface ToastState {
  toasts: Toast[]
  show: (type: ToastType, message: string, duration?: number) => number
  dismiss: (id: number) => void
  clear: () => void
}

let nextId = 1

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  show: (type, message, duration = 4000) => {
    const id = nextId++
    set((state) => ({ toasts: [...state.toasts, { id, type, message, duration }] }))
    if (duration > 0) {
      window.setTimeout(() => get().dismiss(id), duration)
    }
    return id
  },

  dismiss: (id: number) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
  },

  clear: () => set({ toasts: [] })
}))

export const toast = {
  success: (message: string, duration?: number) =>
    useToastStore.getState().show('success', message, duration),
  warning: (message: string, duration?: number) =>
    useToastStore.getState().show('warning', message, duration),
  error: (message: string, duration?: number) =>
    useToastStore.getState().show('error', message, duration),
  info: (message: string, duration?: number) =>
    useToastStore.getState().show('info', message, duration)
}
