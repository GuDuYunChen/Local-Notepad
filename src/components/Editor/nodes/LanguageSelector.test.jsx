import { describe, it, expect } from 'vitest';
import { SUPPORTED_LANGUAGES, validateLanguage } from './CodeBlockNode';

describe('LanguageSelector', () => {
  /**
   * **Validates: Requirements 2.1, 2.3**
   * 
   * Test that the supported languages list contains at least 50 languages
   */
  it('should have at least 50 supported languages', () => {
    expect(SUPPORTED_LANGUAGES.length).toBeGreaterThanOrEqual(50);
  });

  /**
   * **Validates: Requirements 2.3**
   * 
   * Test that all required common languages are included
   */
  it('should include common programming languages', () => {
    const requiredLanguages = [
      'javascript', 'typescript', 'python', 'java', 'cpp', 
      'go', 'rust', 'markup', 'css', 'json', 'yaml', 
      'markdown', 'sql', 'bash', 'plaintext'
    ];

    const supportedValues = SUPPORTED_LANGUAGES.map(lang => lang.value);
    
    requiredLanguages.forEach(lang => {
      expect(supportedValues).toContain(lang);
    });
  });

  /**
   * **Validates: Requirements 2.1**
   * 
   * Test that each language has both value and label
   */
  it('should have value and label for each language', () => {
    SUPPORTED_LANGUAGES.forEach(lang => {
      expect(lang).toHaveProperty('value');
      expect(lang).toHaveProperty('label');
      expect(typeof lang.value).toBe('string');
      expect(typeof lang.label).toBe('string');
      expect(lang.value.length).toBeGreaterThan(0);
      expect(lang.label.length).toBeGreaterThan(0);
    });
  });

  /**
   * **Validates: Requirements 2.3**
   * 
   * Test that validateLanguage returns valid language for supported languages
   */
  it('should validate supported languages correctly', () => {
    const testLanguages = ['javascript', 'python', 'java', 'cpp', 'plaintext'];
    
    testLanguages.forEach(lang => {
      expect(validateLanguage(lang)).toBe(lang);
    });
  });

  /**
   * **Validates: Requirements 2.3**
   * 
   * Test that validateLanguage falls back to plaintext for unsupported languages
   */
  it('should fallback to plaintext for unsupported languages', () => {
    const unsupportedLanguages = ['invalid', 'unknown', 'fake-lang', ''];
    
    unsupportedLanguages.forEach(lang => {
      expect(validateLanguage(lang)).toBe('plaintext');
    });
  });

  /**
   * **Validates: Requirements 2.3**
   * 
   * Test that validateLanguage handles edge cases
   */
  it('should handle edge cases in language validation', () => {
    // Test with undefined
    expect(validateLanguage(undefined)).toBe('plaintext');
    
    // Test with null
    expect(validateLanguage(null)).toBe('plaintext');
    
    // Test with empty string
    expect(validateLanguage('')).toBe('plaintext');
    
    // Test with whitespace
    expect(validateLanguage('   ')).toBe('plaintext');
  });

  /**
   * **Validates: Requirements 2.1**
   * 
   * Test that language values are unique
   */
  it('should have unique language values', () => {
    const values = SUPPORTED_LANGUAGES.map(lang => lang.value);
    const uniqueValues = new Set(values);
    
    expect(uniqueValues.size).toBe(values.length);
  });

  /**
   * **Validates: Requirements 2.1**
   * 
   * Test that plaintext is included as the default language
   */
  it('should include plaintext as a supported language', () => {
    const plaintextLang = SUPPORTED_LANGUAGES.find(lang => lang.value === 'plaintext');
    
    expect(plaintextLang).toBeDefined();
    expect(plaintextLang.value).toBe('plaintext');
    expect(plaintextLang.label).toBeTruthy();
  });

  /**
   * **Validates: Requirements 2.3**
   * 
   * Test that all language values are lowercase or follow consistent naming
   */
  it('should have consistent language value naming', () => {
    SUPPORTED_LANGUAGES.forEach(lang => {
      // Language values should not have spaces
      expect(lang.value).not.toMatch(/\s/);
      
      // Language values should be lowercase or follow kebab-case
      expect(lang.value).toMatch(/^[a-z0-9-]+$/);
    });
  });
});
