import { toast as sonnerToast } from 'sonner';

type ToastMessageOptions = {
  description?: string;
  duration?: number;
};

/** Bullseye wrapper around [Sonner](https://ui.shadcn.com/docs/components/radix/sonner) (shadcn-style toaster). */
export const toast = {
  success(message: string, options?: ToastMessageOptions) {
    return sonnerToast.success(message, {
      description: options?.description,
      duration: options?.duration ?? 4500,
    });
  },

  error(message: string, options?: ToastMessageOptions) {
    return sonnerToast.error(message, {
      description: options?.description,
      duration: options?.duration ?? 6500,
    });
  },

  message(message: string, options?: ToastMessageOptions) {
    return sonnerToast(message, {
      description: options?.description,
      duration: options?.duration ?? 4500,
    });
  },
};
