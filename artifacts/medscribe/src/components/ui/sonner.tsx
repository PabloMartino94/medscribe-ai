import { useTheme } from "next-themes"
import { Toaster as Sonner } from "sonner"
import { useIsMobile } from "@/hooks/use-mobile"

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()
  const isMobile = useIsMobile()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      // On a phone the bottom right corner is the record button, and a toast
      // there eats the tap that starts the next patient's recording. Lifting it
      // clear of the action bar keeps both reachable — moving it to the top
      // instead would have covered the patient's name and allergy line.
      position={isMobile ? "bottom-center" : "bottom-right"}
      // `offset` is ignored on small screens — sonner reads `mobileOffset`
      // there instead — so setting only the first one moved nothing.
      mobileOffset={{ bottom: "116px", left: "12px", right: "12px" }}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
