import { Button, toast } from "@medusajs/ui"
import { Sparkles } from "@medusajs/icons"
import { defineWidgetConfig } from "@medusajs/admin-sdk"

// This is the React component for your widget.
const ToasterButtonWidget = () => {
  // This function will be called when the button is clicked.
  const handleClick = () => {
    // Show a success toast using @medusajs/ui
    toast.success("Notification", {
      description: "Hello",
    })
  }

  return (
    <Button
      variant="secondary"
      size="small"
      onClick={handleClick}
      className="w-full"
    >
      <Sparkles />
      Trigger Toaster
    </Button>
  )
}

// This config object tells Medusa where to place your widget.
// "admin.list_setting.before" injects it into the main sidebar
// right before the "Settings" link.
export const config = defineWidgetConfig({
  // Use a valid injection zone; choose a page where you want the button.
  // For example, place it above the orders list:
  zone: "order.list.before",
})

export default ToasterButtonWidget;