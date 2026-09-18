package dao

import "testing"

func TestEscapeFTS5Query(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{name: "single chinese term", in: "工业富联", want: `"工业富联"*`},
		{name: "multiple terms", in: "project plan", want: `"project"* AND "plan"*`},
		{name: "strip operators", in: "hello*(world)?", want: `"helloworld"*`},
		{name: "trim spaces", in: "  hello  world  ", want: `"hello"* AND "world"*`},
		{name: "empty", in: "   ", want: ""},
		{name: "operators only", in: "***???", want: ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := escapeFTS5Query(tt.in); got != tt.want {
				t.Fatalf("escapeFTS5Query(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestEscapeLikePattern(t *testing.T) {
	got := escapeLikePattern(" 100%_\\safe ")
	want := `%100\%\_\\safe%`
	if got != want {
		t.Fatalf("escapeLikePattern() = %q, want %q", got, want)
	}
}
