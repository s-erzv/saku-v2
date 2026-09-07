interface SearchBarProps {
  onPayClick?: () => void;
}

export default function SearchBar({ onPayClick }: SearchBarProps) {
  return (
    <div className="space-y-3">
      <input
        type="text"
        placeholder="Search transactions or contacts"
        className="w-full px-4 py-3 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
      />
      <div className="flex gap-2">
        <button
          onClick={onPayClick}
          className="flex-1 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition"
        >
          Pay
        </button>
        <button className="flex-1 px-4 py-2 border border-border rounded-lg hover:bg-muted transition">
          Request
        </button>
      </div>
    </div>
  );
}
