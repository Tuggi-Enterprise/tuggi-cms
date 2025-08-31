import React from 'react';

interface SelectProps {
  value?: string;
  onValueChange?: (value: any) => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}

interface SelectTriggerProps {
  children: React.ReactNode;
  className?: string;
}

interface SelectValueProps {
  placeholder?: string;
  children?: React.ReactNode;
}

interface SelectContentProps {
  children: React.ReactNode;
  className?: string;
}

interface SelectItemProps {
  value: string;
  children: React.ReactNode;
  className?: string;
}

export const Select: React.FC<SelectProps> = ({ 
  value, 
  onValueChange, 
  children, 
  className = '',
  disabled = false 
}) => {
  return (
    <select
      value={value}
      onChange={(e) => onValueChange?.(e.target.value)}
      disabled={disabled}
      className={`block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm ${className}`}
    >
      {children}
    </select>
  );
};

export const SelectTrigger: React.FC<SelectTriggerProps> = ({ children, className = '' }) => {
  return <div className={className}>{children}</div>;
};

export const SelectValue: React.FC<SelectValueProps> = ({ placeholder, children }) => {
  return <span>{children || placeholder}</span>;
};

export const SelectContent: React.FC<SelectContentProps> = ({ children, className = '' }) => {
  return <div className={className}>{children}</div>;
};

export const SelectItem: React.FC<SelectItemProps> = ({ value, children, className = '' }) => {
  return (
    <option value={value} className={className}>
      {children}
    </option>
  );
};
