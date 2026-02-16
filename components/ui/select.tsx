import React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  onValueChange?: (value: string) => void;
}

export const Select: React.FC<SelectProps> = ({ 
  value, 
  onValueChange, 
  children, 
  className,
  ...props 
}) => {
  return (
    <div className="relative group">
      <select
        value={value}
        onChange={(e) => onValueChange?.(e.target.value)}
        className={cn(
          "appearance-none block w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm font-bold text-gray-700 dark:text-gray-300 focus:ring-4 focus:ring-tuggi-blue/10 focus:border-tuggi-blue outline-none transition-all cursor-pointer shadow-sm hover:border-gray-300 dark:hover:border-gray-600",
          className
        )}
        {...props}
      >
        {children}
      </select>
      <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-gray-400 group-hover:text-tuggi-blue transition-colors">
        <ChevronDown size={14} strokeWidth={3} />
      </div>
    </div>
  );
};


export const SelectTrigger: React.FC<any> = ({ children }) => <>{children}</>;
export const SelectValue: React.FC<any> = ({ placeholder, children }) => <>{children || placeholder}</>;
export const SelectContent: React.FC<any> = ({ children }) => <>{children}</>;

export const SelectItem: React.FC<React.OptionHTMLAttributes<HTMLOptionElement>> = ({ value, children, className, ...props }) => {
  return (
    <option value={value} className={cn("py-2", className)} {...props}>
      {children}
    </option>
  );
};

