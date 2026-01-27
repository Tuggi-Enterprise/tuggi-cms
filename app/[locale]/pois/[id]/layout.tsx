export default function POILayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-tuggi-background">
      {children}
    </div>
  )
}
