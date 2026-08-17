import React from 'react';

/**
 * The hand-written prop list this component used to carry silently dropped everything it
 * did not name — including `aria-describedby`, which is how a field says out loud which
 * helper text explains it. Extending `TextareaHTMLAttributes` keeps every existing call
 * site working and stops the next accessibility attribute from disappearing in silence.
 */
export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

export const Textarea: React.FC<TextareaProps> = ({
  className = '',
  rows = 3,
  ...props
}) => {
  return (
    <textarea
      rows={rows}
      className={`block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm ${className}`}
      {...props}
    />
  );
};
