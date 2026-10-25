import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      position="top-center"
      offset={{ top: 116, right: 16, bottom: 16, left: 16 }}
      className="toaster group"
      style={
        {
          "--normal-bg": "#6f2088",
          "--normal-text": "#ffffff",
          "--normal-border": "#d081f1",
          top: "116px",
          left: "50%",
          right: "auto",
          bottom: "auto",
          transform: "translateX(-50%)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
