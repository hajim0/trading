import React, { useState, useEffect, useCallback } from 'react';
import { Plus, PenLine, FileUp, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';

interface FloatingActionButtonProps {
  onClick: () => void;
  onQuickRecord?: () => void;
  onImport?: () => void;
}

export const FloatingActionButton: React.FC<FloatingActionButtonProps> = React.memo(({
  onClick,
  onQuickRecord,
  onImport,
}) => {
  const [isVisible, setIsVisible] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);
  const [isOpen, setIsOpen] = useState(false);

  const handleScroll = useCallback(() => {
    const currentScrollY = window.scrollY;
    
    // Show if at the very top
    if (currentScrollY < 10) {
      setIsVisible(true);
    } 
    // Hide if scrolling down, show if scrolling up
    else if (currentScrollY > lastScrollY) {
      setIsVisible(false);
      setIsOpen(false); // Close menu when hiding
    } else {
      setIsVisible(true);
    }
    
    setLastScrollY(currentScrollY);
  }, [lastScrollY]);

  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          handleScroll();
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, [handleScroll]);

  return (
    <div className="fixed bottom-6 right-6 z-[100]">
      <AnimatePresence>
        {isVisible && (
          <motion.button
            initial={{ opacity: 0, y: 50, scale: 0.5 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 50, scale: 0.5 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={onClick}
            className={cn(
              "w-14 h-14 rounded-full flex items-center justify-center shadow-2xl transition-all duration-300",
              "bg-black border border-white/20 text-white",
              "hover:shadow-[0_0_30px_rgba(255,255,255,0.15)]"
            )}
          >
            <Plus size={28} strokeWidth={2.5} />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
});
