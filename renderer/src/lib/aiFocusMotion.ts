import { useEffect, type RefObject } from 'react';
import { spring, stagger, waapi } from 'animejs';

type MotionElement = HTMLElement | SVGElement;

interface StageSwapOptions {
  childSelector?: string;
  childDelayStart?: number;
}

interface ListMotionOptions {
  selector: string;
  axis?: 'x' | 'y';
  distance?: number;
  startDelay?: number;
}

function motionEnabled(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function uniqueElements(elements: MotionElement[]): MotionElement[] {
  return Array.from(new Set(elements.filter(Boolean)));
}

function cancelAnimations(elements: MotionElement[]): void {
  for (const element of uniqueElements(elements)) {
    if (typeof element.getAnimations !== 'function') {
      continue;
    }
    for (const animation of element.getAnimations()) {
      animation.cancel();
    }
  }
}

function queryMotionTargets(root: HTMLElement | null, selector?: string): MotionElement[] {
  if (!root || !selector) {
    return [];
  }
  return Array.from(root.querySelectorAll<MotionElement>(selector));
}

function buildOffsetTransform(axis: 'x' | 'y', distance: number): string {
  return axis === 'x'
    ? `translate3d(${distance}px, 0, 0)`
    : `translate3d(0, ${distance}px, 0)`;
}

export function useStageSwapMotion(
  ref: RefObject<HTMLElement | null>,
  triggerKey: string,
  options: StageSwapOptions = {},
): void {
  useEffect(() => {
    const root = ref.current;
    if (!root || !motionEnabled()) {
      return;
    }

    const children = queryMotionTargets(root, options.childSelector);
    cancelAnimations([root, ...children]);

    const animations = [
      waapi.animate(root, {
        opacity: [0.72, 1],
        transform: ['translate3d(0, 22px, 0) scale(0.985)', 'translate3d(0, 0, 0) scale(1)'],
        filter: ['blur(14px)', 'blur(0px)'],
        duration: 620,
        ease: spring({ duration: 620, bounce: 0.22 }),
      }),
    ];

    if (children.length > 0) {
      animations.push(
        waapi.animate(children, {
          opacity: [0, 1],
          transform: ['translate3d(0, 18px, 0)', 'translate3d(0, 0, 0)'],
          duration: 460,
          delay: stagger(70, { start: options.childDelayStart ?? 90 }),
          ease: spring({ duration: 460, bounce: 0.16 }),
        }),
      );
    }

    return () => {
      for (const animation of animations) {
        animation.cancel();
      }
    };
  }, [ref, triggerKey, options.childDelayStart, options.childSelector]);
}

export function useListStaggerMotion(
  ref: RefObject<HTMLElement | null>,
  triggerKey: string,
  options: ListMotionOptions,
): void {
  useEffect(() => {
    const root = ref.current;
    if (!root || !motionEnabled()) {
      return;
    }

    const items = queryMotionTargets(root, options.selector);
    if (items.length === 0) {
      return;
    }

    cancelAnimations(items);

    const animation = waapi.animate(items, {
      opacity: [0, 1],
      transform: [
        buildOffsetTransform(options.axis ?? 'y', options.distance ?? 16),
        'translate3d(0, 0, 0)',
      ],
      duration: 380,
      delay: stagger(58, { start: options.startDelay ?? 36 }),
      ease: spring({ duration: 380, bounce: 0.12 }),
    });

    return () => {
      animation.cancel();
    };
  }, [ref, triggerKey, options.axis, options.distance, options.selector, options.startDelay]);
}
